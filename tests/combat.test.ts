import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createEngineState,
  combatantExportSchema,
  DEFAULT_GRID_VISUALS,
  DEFAULT_MAP_IMAGE_SETTINGS,
  encounterSnapshotSchema,
  applyCondition,
  expireConditions,
  getExecutableActions,
  moveCombatant,
  parseCombatantPackage,
  resolveActivateFeatureAction,
  resolveDeathSave,
  resolveHealingAction,
  resolveAttack,
  resolveAttackBonus,
  resolveAreaSaveAction,
  resolveMultiattackAction,
  resolveSaveDc,
  resolveSaveAction,
  rollInitiative,
  runBatchSimulations,
  runAutomatedEncounter,
  sampleEncounter,
  takeAutomatedTurn
} from "@/engine";
import type { EncounterSnapshot, RandomSource } from "@/engine";

function scriptedRng(valuesBySides: Record<number, number[]>): RandomSource {
  const indexes: Record<number, number> = {};
  return {
    next: () => 0,
    nextInt: (minInclusive, maxInclusive) => {
      const index = indexes[maxInclusive] ?? 0;
      indexes[maxInclusive] = index + 1;
      const value = valuesBySides[maxInclusive]?.[index] ?? minInclusive;
      if (value < minInclusive || value > maxInclusive) {
        throw new Error(`Fixed roll ${value} is outside ${minInclusive}-${maxInclusive}`);
      }
      return value;
    },
    fork: () => scriptedRng(valuesBySides)
  };
}

describe("combat engine", () => {
  it("validates the versioned sample encounter schema", () => {
    expect(() => encounterSnapshotSchema.parse(sampleEncounter)).not.toThrow();
  });

  it("adds default map visual settings to older encounter snapshots", () => {
    const legacyEncounter = structuredClone(sampleEncounter) as unknown as Record<string, unknown>;
    const legacyMap = legacyEncounter.map as { grid: Record<string, unknown>; image?: unknown };
    delete legacyMap.grid.squareSizePx;
    delete legacyMap.grid.lineColor;
    delete legacyMap.grid.lineOpacity;
    delete legacyMap.grid.lineWidthPx;
    delete legacyMap.image;

    const parsed = encounterSnapshotSchema.parse(legacyEncounter);

    expect(parsed.map.grid.squareSizePx).toBe(DEFAULT_GRID_VISUALS.squareSizePx);
    expect(parsed.map.grid.lineColor).toBe(DEFAULT_GRID_VISUALS.lineColor);
    expect(parsed.map.grid.lineOpacity).toBe(DEFAULT_GRID_VISUALS.lineOpacity);
    expect(parsed.map.grid.lineWidthPx).toBe(DEFAULT_GRID_VISUALS.lineWidthPx);
    expect(parsed.map.image).toEqual(DEFAULT_MAP_IMAGE_SETTINGS);
  });

  it("preserves token visual metadata in saved encounter snapshots", () => {
    const encounter = structuredClone(sampleEncounter);
    encounter.definitions[0] = {
      ...encounter.definitions[0],
      tokenVisuals: {
        imageUrl: "data:image/png;base64,definition",
        scale: 1.1,
        borderColor: "#ffffff"
      }
    };
    encounter.combatants[0] = {
      ...encounter.combatants[0],
      tokenVisuals: {
        imageUrl: "data:image/png;base64,token",
        showNameplate: true
      }
    };

    const parsed = encounterSnapshotSchema.parse(encounter);

    expect(parsed.definitions[0]?.tokenVisuals?.imageUrl).toBe("data:image/png;base64,definition");
    expect(parsed.combatants[0]?.tokenVisuals?.imageUrl).toBe("data:image/png;base64,token");
    expect(parsed.combatants[0]?.tokenVisuals?.showNameplate).toBe(true);
  });

  it("preserves placed area templates in saved encounter snapshots", () => {
    const encounter = structuredClone(sampleEncounter);
    encounter.map.templates = [
      {
        id: "template-fireball",
        name: "Fireball",
        origin: { x: 4, y: 4 },
        area: { type: "circle", size: 20, direction: "east", width: 5 },
        affects: "all",
        color: "#b84536"
      }
    ];

    const parsed = encounterSnapshotSchema.parse(encounter);

    expect(parsed.map.templates?.[0]).toMatchObject({
      id: "template-fireball",
      name: "Fireball",
      area: { type: "circle", size: 20 },
      affects: "all"
    });
  });

  it("validates exported combatant packages and migrates legacy tactics", () => {
    const definition = structuredClone(sampleEncounter.definitions[0]);
    const combatant = structuredClone(sampleEncounter.combatants[0]) as unknown as Record<string, unknown>;
    delete combatant.id;
    delete combatant.definitionId;
    delete combatant.initiative;
    delete combatant.actionEconomy;
    combatant.tacticsProfile = "manual";
    combatant.tokenVisuals = { imageUrl: "data:image/png;base64,token", showNameplate: true };

    const parsed = combatantExportSchema.parse({
      kind: "battle-sim-combatant",
      schemaVersion: 1,
      exportedAt: "2026-09-06T00:00:00.000Z",
      definition,
      combatant
    });

    expect(parsed.definition.name).toBe("Test Fighter");
    expect(parsed.combatant?.tacticsProfile).toBe("basic-melee");
    expect(parsed.combatant?.tokenVisuals?.imageUrl).toBe("data:image/png;base64,token");
  });

  it("normalizes richer combatant templates into executable engine data", () => {
    const raw = JSON.parse(readFileSync("barbarian-template.json", "utf8")) as unknown;
    const parsed = parseCombatantPackage(raw);
    const definition = parsed.definition;
    const actions = getExecutableActions(definition);
    const greataxe = actions.find((action) => action.id === "greataxe-attack");
    const attackAction = actions.find((action) => action.id === "attack-action");
    const rageAction = actions.find((action) => action.id === "activate-rage");

    expect(definition.saves).toMatchObject({ str: 7, con: 6 });
    expect(definition.resources).toMatchObject({ rage: 4 });
    expect(definition.features?.every((feature) => feature.category === "feature")).toBe(true);
    expect(definition.weapons?.[0]).toMatchObject({
      attackType: "melee",
      ability: "str",
      range: 5,
      reach: 5,
      magicBonus: 1,
      actionId: "greataxe-attack",
      damage: [{ dice: "1d12", damageType: "slashing", abilityModifier: "str" }]
    });
    expect(actions.filter((action) => action.id === "greataxe-attack")).toHaveLength(1);
    expect(greataxe?.kind).toBe("attack");
    if (greataxe?.kind !== "attack") throw new Error("missing greataxe attack");
    expect(resolveAttackBonus(greataxe, definition)).toBe(8);
    expect(greataxe.damage[0]?.bonusFormula?.base).toBe(1);
    expect(attackAction?.kind).toBe("multiattack");
    expect(rageAction).toMatchObject({
      kind: "activate-feature",
      actionType: "bonus",
      featureId: "rage",
      resourceCost: { resourceId: "rage", amount: 1 },
      condition: {
        id: "rage-active",
        effects: expect.arrayContaining([
          expect.objectContaining({ kind: "damage-bonus" }),
          expect.objectContaining({ kind: "damage-adjustment" }),
          expect.objectContaining({ kind: "save-advantage", ability: "str" })
        ])
      },
      automationSupport: "full"
    });
    expect(parsed.combatant?.resources?.rage).toBe(4);
  });

  it("normalizes the lore bard template into usable actions and tracked resources", () => {
    const raw = JSON.parse(readFileSync("bard-template.json", "utf8")) as unknown;
    const parsed = parseCombatantPackage(raw);
    const definition = parsed.definition;
    const actions = getExecutableActions(definition);
    const rapier = actions.find((action) => action.id === "rapier-attack");
    const viciousMockery = actions.find((action) => action.id === "vicious-mockery");
    const fireball = actions.find((action) => action.id === "fireball");
    const bardicInspiration = actions.find((action) => action.id === "bardic-inspiration-action");
    const cuttingWords = actions.find((action) => action.id === "cutting-words-reaction");
    const counterspell = actions.find((action) => action.id === "counterspell");

    expect(definition.saves).toMatchObject({ dex: 6, cha: 7 });
    expect(definition.resources).toMatchObject({
      "bardic-inspiration": 4,
      "slot-1": 4,
      "slot-2": 3,
      "slot-3": 3
    });
    expect(definition.features?.every((feature) => feature.category === "feature")).toBe(true);
    expect(definition.weapons?.[0]).toMatchObject({
      attackType: "melee",
      ability: "dex",
      range: 5,
      reach: 5,
      actionId: "rapier-attack",
      damage: [{ dice: "1d8", damageType: "piercing", abilityModifier: "dex" }]
    });
    expect(actions.filter((action) => action.id === "rapier-attack")).toHaveLength(1);
    expect(rapier?.kind).toBe("attack");
    if (rapier?.kind !== "attack") throw new Error("missing rapier attack");
    expect(resolveAttackBonus(rapier, definition)).toBe(6);
    expect(viciousMockery).toMatchObject({
      kind: "save",
      saveAbility: "wis",
      range: 60,
      automationSupport: "full"
    });
    if (viciousMockery?.kind !== "save") throw new Error("missing Vicious Mockery");
    expect(resolveSaveDc(viciousMockery, definition)).toBe(16);
    expect(fireball).toMatchObject({
      kind: "area-save",
      saveAbility: "dex",
      range: 150,
      area: { type: "circle", size: 20 },
      resourceCost: { resourceId: "slot-3", amount: 1 },
      automationSupport: "full"
    });
    if (fireball?.kind !== "area-save") throw new Error("missing Fireball");
    expect(resolveSaveDc(fireball, definition)).toBe(16);
    const magicFocus = definition.features?.find((feature) => feature.id === "plus-one-magic-focus");
    expect(magicFocus).toMatchObject({
      name: "+1 Magic Focus",
      automationSupport: "full",
      effects: expect.arrayContaining([
        { kind: "attack-bonus", bonus: { base: 1 }, attackTypes: ["spell"] },
        {
          kind: "save-dc-bonus",
          bonus: { base: 1 },
          actionIds: ["vicious-mockery", "dissonant-whispers", "shatter", "fireball"]
        }
      ])
    });
    expect(bardicInspiration).toMatchObject({
      kind: "activate-feature",
      actionType: "bonus",
      featureId: "bardic-inspiration",
      resourceCost: { resourceId: "bardic-inspiration", amount: 1 },
      automationSupport: "partial"
    });
    expect(cuttingWords).toMatchObject({
      kind: "activate-feature",
      actionType: "reaction",
      featureId: "cutting-words",
      automationSupport: "partial"
    });
    expect(counterspell).toMatchObject({
      kind: "activate-feature",
      actionType: "reaction",
      featureId: "counterspell",
      resourceCost: { resourceId: "slot-3", amount: 1 },
      automationSupport: "partial"
    });
    expect(parsed.combatant?.resources).toMatchObject({
      "bardic-inspiration": 4,
      "slot-1": 4,
      "slot-2": 3,
      "slot-3": 3
    });
  });

  it("normalizes the Spiritbound Marksman Deadeye package into executable shot and mark effects", () => {
    const raw = JSON.parse(readFileSync("spirit-marksman.json", "utf8")) as unknown;
    const parsed = parseCombatantPackage(raw);
    const definition = parsed.definition;
    const actions = getExecutableActions(definition);
    const shot = actions.find((action) => action.id === "spiritfire-shot");
    const spiritfireAttack = actions.find((action) => action.id === "spiritfire-gun-attack");
    const agonizingEcho = definition.features?.find((feature) => feature.id === "agonizing-echo");
    const deathsBrand = definition.features?.find((feature) => feature.id === "deaths-brand");

    expect(definition.source?.url).toBe("https://dnd.spudfurd.dev/spiritbound_marksman");
    expect(definition.character).toMatchObject({
      level: 6,
      classes: [
        {
          id: "spiritbound-marksman",
          name: "Spiritbound Marksman",
          level: 6,
          subclass: {
            id: "path-of-the-deadeye",
            name: "Path of the Deadeye"
          }
        }
      ]
    });
    expect(definition.saves).toMatchObject({ con: 5, wis: 7 });
    expect(shot).toMatchObject({
      kind: "attack",
      attackType: "ranged",
      ability: "wis",
      range: 60,
      longRange: 120,
      automationSupport: "full"
    });
    expect(spiritfireAttack).toMatchObject({
      kind: "multiattack",
      attacks: [{ actionId: "spiritfire-shot", count: 2 }]
    });
    expect(agonizingEcho).toMatchObject({
      automationSupport: "full",
      effects: [{
        kind: "damage-bonus",
        actionIds: ["spiritfire-shot"],
        damage: [{ dice: "0", damageType: "same-as-attack", bonusFormula: { ability: "wis" } }]
      }]
    });
    expect(deathsBrand).toMatchObject({
      automationSupport: "full",
      effects: [{
        kind: "apply-condition-on-hit",
        actionIds: ["spiritfire-shot"],
        oncePerTurn: true,
        appliedCondition: {
          id: "deaths-brand-active",
          effects: [{
            kind: "incoming-hit-damage",
            damage: [{ dice: "2d6", damageType: "necrotic" }],
            consumeCondition: true
          }]
        }
      }]
    });
    expect(parsed.combatant?.resources).toMatchObject({ "second-deaths-brand": 1 });
  });

  it("applies magic focus bonuses to spell attacks and spell save DCs", () => {
    const parsed = parseCombatantPackage(JSON.parse(readFileSync("bard-template.json", "utf8")) as unknown);
    const bard = parsed.definition;
    bard.actions.push({
      kind: "attack",
      id: "test-spell-attack",
      name: "Test Spell Attack",
      actionType: "action",
      attackType: "spell",
      ability: "cha",
      attackBonusFormula: { ability: "cha", proficiency: true },
      range: 60,
      damage: [{ dice: "1", damageType: "force" }],
      automationSupport: "full"
    });
    const encounter: EncounterSnapshot = {
      ...structuredClone(sampleEncounter),
      seed: "bard-focus",
      map: { ...structuredClone(sampleEncounter.map), walls: [] },
      definitions: [
        bard,
        {
          id: "def-target",
          name: "Target",
          source: { provider: "homebrew" },
          size: "medium",
          armorClass: 1,
          maxHp: 20,
          speed: 30,
          abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          actions: []
        }
      ],
      combatants: [
        {
          id: "bard",
          definitionId: bard.id,
          displayName: "Lore Bard",
          faction: "party",
          position: { x: 1, y: 1 },
          currentHp: 45,
          tempHp: 0,
          state: "active",
          tacticsProfile: "basic-ranged"
        },
        {
          id: "target",
          definitionId: "def-target",
          displayName: "Target",
          faction: "enemy",
          position: { x: 2, y: 1 },
          currentHp: 20,
          tempHp: 0,
          state: "active",
          tacticsProfile: "basic-melee"
        }
      ]
    };

    const state = createEngineState(encounter);
    const result = resolveAttack(state, "bard", "target", "test-spell-attack");
    const attackEvent = state.log.find((entry) => entry.type === "AttackRolled");
    const saveAction = bard.actions.find((action) => action.id === "vicious-mockery");

    expect(result.total - result.attackRoll.total).toBe(8);
    expect(attackEvent?.data?.featureAttackBonus).toBe(1);
    expect(attackEvent?.data?.appliedAttackEffects).toContain("+1 Magic Focus");
    if (saveAction?.kind !== "save") throw new Error("missing Vicious Mockery");
    expect(resolveSaveDc(saveAction, bard)).toBe(16);
  });

  it("rolls deterministic initiative order", () => {
    const first = createEngineState(sampleEncounter);
    const second = createEngineState(sampleEncounter);
    rollInitiative(first);
    rollInitiative(second);
    expect(first.snapshot.combatants.map((combatant) => combatant.id)).toEqual(
      second.snapshot.combatants.map((combatant) => combatant.id)
    );
  });

  it("rolls initiative for combatants with negative Dexterity modifiers", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter");
    if (fighter) fighter.abilities.dex = 8;

    const state = createEngineState(encounter);
    expect(() => rollInitiative(state)).not.toThrow();
    const roll = state.log.find((entry) => entry.type === "InitiativeRolled")?.data?.rolls as Array<{ rolls: unknown[]; total: number }> | undefined;
    expect(roll?.[0]?.rolls).toBeDefined();
  });

  it("applies resistance after damage is rolled", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "damage-resistance";
    encounter.map.walls = [];
    encounter.definitions.push({
      id: "def-resistant",
      name: "Training Dummy",
      source: { provider: "homebrew" },
      size: "medium",
      armorClass: 1,
      maxHp: 20,
      speed: 0,
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      damageAdjustments: [{ type: "resistance", damageType: "slashing" }],
      actions: []
    });
    encounter.combatants = [
      {
        id: "attacker",
        definitionId: "def-fighter",
        displayName: "Attacker",
        faction: "party",
        position: { x: 1, y: 1 },
        currentHp: 32,
        tempHp: 0,
        state: "active",
        tacticsProfile: "basic-melee"
      },
      {
        id: "target",
        definitionId: "def-resistant",
        displayName: "Target",
        faction: "enemy",
        position: { x: 2, y: 1 },
        currentHp: 20,
        tempHp: 0,
        state: "active",
        tacticsProfile: "basic-melee"
      }
    ];
    const action = encounter.definitions.find((definition) => definition.id === "def-fighter")?.actions[0];
    if (action?.kind === "attack") {
      action.attackBonus = 100;
      action.damage = [{ dice: "7", damageType: "slashing" }];
    }

    const state = createEngineState(encounter);
    const result = resolveAttack(state, "attacker", "target", "longsword");
    expect(result.hit).toBe(true);
    expect(result.damageApplied).toBe(3);
    expect(state.snapshot.combatants.find((combatant) => combatant.id === "target")?.currentHp).toBe(17);
  });

  it("declares the selected action before resolving attack results", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "action-log";
    encounter.map.walls = [];
    const target = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    if (target) target.position = { x: 2, y: 1 };
    const action = encounter.definitions.find((definition) => definition.id === "def-fighter")?.actions[0];
    if (action?.kind === "attack") {
      action.attackBonus = 100;
      action.damage = [{ dice: "1", damageType: "slashing" }];
    }

    const state = createEngineState(encounter);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");
    const actionIndex = state.log.findIndex((entry) => entry.type === "ActionDeclared");
    const damageIndex = state.log.findIndex((entry) => entry.type === "DamageApplied");
    const attackIndex = state.log.findIndex((entry) => entry.type === "AttackRolled");

    expect(actionIndex).toBeGreaterThanOrEqual(0);
    expect(state.log[actionIndex]?.message).toContain("uses Longsword");
    expect(actionIndex).toBeLessThan(damageIndex);
    expect(actionIndex).toBeLessThan(attackIndex);
    expect(state.log[attackIndex]?.message).toContain("with Longsword");
  });

  it("rolls ordinary attacks without implicit disadvantage", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "normal-attack-roll";
    encounter.map.walls = [];
    const target = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    if (target) target.position = { x: 2, y: 1 };

    const state = createEngineState(encounter);
    const result = resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");
    const attackEvent = state.log.find((entry) => entry.type === "AttackRolled");

    expect(result.attackRoll.expression).toBe("1d20");
    expect(result.attackRoll.rolls).toHaveLength(1);
    expect(attackEvent?.data?.attackRoll).toMatchObject({
      expression: "1d20",
      rolls: expect.arrayContaining([expect.objectContaining({ sides: 20 })])
    });
  });

  it("allows ranged attacks at long range with disadvantage", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "long-range-attack";
    encounter.map.walls = [];
    const attacker = encounter.combatants.find((combatant) => combatant.id === "pc-fighter");
    const target = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    const action = encounter.definitions.find((definition) => definition.id === "def-fighter")?.actions[0];
    if (attacker) attacker.position = { x: 0, y: 0 };
    if (target) target.position = { x: 16, y: 0 };
    if (action?.kind === "attack") {
      action.attackType = "ranged";
      action.range = 60;
      action.longRange = 120;
      action.attackBonus = 0;
      action.damage = [{ dice: "1", damageType: "piercing" }];
    }

    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [20, 2] });
    const result = resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");
    const attackEvent = state.log.find((entry) => entry.type === "AttackRolled");

    expect(result.attackRoll.expression).toBe("1d20 with disadvantage");
    expect(result.attackRoll.total).toBe(2);
    expect(result.hit).toBe(false);
    expect(attackEvent?.data?.longRange).toBe(true);
    expect(attackEvent?.data?.appliedAttackEffects).toContain("Long Range");
  });

  it("runs an automated encounter deterministically from the same snapshot and seed", () => {
    const first = runAutomatedEncounter(sampleEncounter, 20);
    const second = runAutomatedEncounter(sampleEncounter, 20);
    expect(first.outcome).toEqual(second.outcome);
    expect(first.log.map((entry) => entry.type)).toEqual(second.log.map((entry) => entry.type));
  });

  it("logs automated movement and scored action reasons", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "ai-explanation";
    encounter.map.walls = [];
    const fighter = encounter.combatants.find((combatant) => combatant.id === "pc-fighter");
    const goblin = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    if (fighter) fighter.position = { x: 1, y: 1 };
    if (goblin) {
      goblin.position = { x: 5, y: 1 };
      goblin.currentHp = 20;
    }

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter");
    if (!actor) throw new Error("missing fighter");
    takeAutomatedTurn(state, actor);

    expect(state.log.some((entry) => entry.type === "CombatantMoved")).toBe(true);
    expect(state.log.some((entry) => entry.type === "AiDecision" && entry.message.includes("moved"))).toBe(true);
    const decision = state.log.find((entry) => entry.type === "AiDecision" && entry.message.includes("chose Longsword"));
    expect(decision?.data?.reasons).toEqual(expect.arrayContaining([expect.stringContaining("expected damage")]));
  });

  it("provokes opportunity attacks when movement leaves hostile melee reach", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "opportunity-attack";
    encounter.map.walls = [];
    encounter.combatants = encounter.combatants.filter((combatant) => combatant.id === "pc-fighter" || combatant.id === "enemy-goblin-1");
    const fighter = encounter.combatants.find((combatant) => combatant.id === "pc-fighter");
    const goblin = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    const goblinAttack = encounter.definitions.find((definition) => definition.id === "def-goblin")?.actions.find((action) => action.id === "scimitar");
    if (fighter) {
      fighter.position = { x: 1, y: 1 };
      fighter.currentHp = 32;
    }
    if (goblin) {
      goblin.position = { x: 2, y: 1 };
      goblin.actionEconomy = { action: true, bonus: true, reaction: true };
    }
    if (goblinAttack?.kind === "attack") {
      goblinAttack.attackBonus = 100;
      goblinAttack.damage = [{ dice: "1", damageType: "slashing" }];
    }

    const state = createEngineState(encounter);
    moveCombatant(state, "pc-fighter", { x: 1, y: 3 });

    const moved = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter");
    const reactor = state.snapshot.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    expect(moved?.currentHp).toBe(31);
    expect(moved?.position).toEqual({ x: 1, y: 3 });
    expect(reactor?.actionEconomy?.reaction).toBe(false);
    expect(state.log.some((entry) => entry.type === "OpportunityAttackTriggered")).toBe(true);
    expect(state.log.find((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "enemy-goblin-1")?.data?.actionType).toBe("reaction");
  });

  it("controller tactics prefer area damage against clustered enemies", () => {
    const encounter: EncounterSnapshot = {
      ...structuredClone(sampleEncounter),
      seed: "controller-cluster",
      map: { ...structuredClone(sampleEncounter.map), walls: [] },
      definitions: [
        {
          id: "def-controller",
          name: "Controller",
          source: { provider: "homebrew" },
          size: "medium",
          armorClass: 12,
          maxHp: 30,
          speed: 30,
          abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
          actions: [
            {
              kind: "attack",
              id: "force-bolt",
              name: "Force Bolt",
              actionType: "action",
              attackType: "spell",
              ability: "int",
              attackBonus: 100,
              range: 60,
              damage: [{ dice: "5", damageType: "force" }],
              automationSupport: "full"
            },
            {
              kind: "area-save",
              id: "burst",
              name: "Burst",
              actionType: "action",
              saveAbility: "dex",
              dc: 20,
              range: 60,
              area: { type: "circle", size: 10 },
              damage: [{ dice: "3", damageType: "force" }],
              halfDamageOnSuccess: false,
              affects: "hostile",
              automationSupport: "full"
            }
          ]
        },
        {
          id: "def-target",
          name: "Target",
          source: { provider: "homebrew" },
          size: "medium",
          armorClass: 10,
          maxHp: 20,
          speed: 30,
          saves: { dex: 0 },
          abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          actions: []
        }
      ],
      combatants: [
        {
          id: "controller",
          definitionId: "def-controller",
          displayName: "Controller",
          faction: "party",
          position: { x: 1, y: 1 },
          currentHp: 30,
          tempHp: 0,
          state: "active",
          tacticsProfile: "controller"
        },
        {
          id: "target-a",
          definitionId: "def-target",
          displayName: "Target A",
          faction: "enemy",
          position: { x: 5, y: 1 },
          currentHp: 20,
          tempHp: 0,
          state: "active",
          tacticsProfile: "basic-melee"
        },
        {
          id: "target-b",
          definitionId: "def-target",
          displayName: "Target B",
          faction: "enemy",
          position: { x: 5, y: 2 },
          currentHp: 20,
          tempHp: 0,
          state: "active",
          tacticsProfile: "basic-melee"
        }
      ]
    };

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((combatant) => combatant.id === "controller");
    if (!actor) throw new Error("missing controller");
    takeAutomatedTurn(state, actor);

    const decision = state.log.find((entry) => entry.type === "AiDecision" && entry.message.includes("chose Burst"));
    const area = state.log.find((entry) => entry.type === "AreaSaveResolved");
    expect(decision?.data?.actionId).toBe("burst");
    expect(area?.data?.targets).toHaveLength(2);
  });

  it("interrupts movement when an opportunity attack defeats the mover", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "opportunity-attack-interrupt";
    encounter.map.walls = [];
    encounter.combatants = encounter.combatants.filter((combatant) => combatant.id === "pc-fighter" || combatant.id === "enemy-goblin-1");
    const fighter = encounter.combatants.find((combatant) => combatant.id === "pc-fighter");
    const goblin = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    const goblinAttack = encounter.definitions.find((definition) => definition.id === "def-goblin")?.actions.find((action) => action.id === "scimitar");
    if (fighter) {
      fighter.position = { x: 1, y: 1 };
      fighter.currentHp = 1;
    }
    if (goblin) {
      goblin.position = { x: 2, y: 1 };
      goblin.actionEconomy = { action: true, bonus: true, reaction: true };
    }
    if (goblinAttack?.kind === "attack") {
      goblinAttack.attackBonus = 100;
      goblinAttack.damage = [{ dice: "1", damageType: "slashing" }];
    }

    const state = createEngineState(encounter);
    moveCombatant(state, "pc-fighter", { x: 1, y: 3 });

    const moved = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter");
    const movement = [...state.log].reverse().find((entry) => entry.type === "CombatantMoved");
    expect(moved?.state).toBe("downed");
    expect(moved?.position).toEqual({ x: 1, y: 2 });
    expect(movement?.data?.interrupted).toBe(true);
  });

  it("supports healing a downed player back into combat", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "healing";
    encounter.map.walls = [];
    encounter.definitions[1]?.actions.push({
      kind: "healing",
      id: "healing-word",
      name: "Healing Word",
      actionType: "bonus",
      range: 60,
      healing: [{ dice: "4" }],
      automationSupport: "full"
    });
    const fighter = encounter.combatants.find((combatant) => combatant.id === "pc-fighter");
    if (fighter) {
      fighter.currentHp = 0;
      fighter.state = "downed";
      fighter.deathSaves = { successes: 0, failures: 0, stable: false };
    }

    const state = createEngineState(encounter);
    const result = resolveHealingAction(state, "pc-archer", "pc-fighter", "healing-word");
    const healed = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter");
    expect(result.healingApplied).toBe(4);
    expect(healed?.state).toBe("active");
    expect(healed?.currentHp).toBe(4);
  });

  it("rolls death saves for downed player characters", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    const fighter = encounter.combatants.find((combatant) => combatant.id === "pc-fighter");
    if (fighter) {
      fighter.currentHp = 0;
      fighter.state = "downed";
    }

    const state = createEngineState(encounter);
    const result = resolveDeathSave(state, "pc-fighter");
    expect(result.successes + result.failures).toBeGreaterThanOrEqual(1);
  });

  // A 100-encounter CPU stress test — needs headroom over the 5s default when the
  // whole suite is spawning workers in parallel (runs in ~2.5s on its own).
  it("runs 100 headless simulations and reports aggregate outcomes", () => {
    const summary = runBatchSimulations(sampleEncounter, 100, { seedPrefix: "regression", maxRounds: 20 });
    expect(summary.runCount).toBe(100);
    expect(summary.rounds.max).toBeGreaterThanOrEqual(summary.rounds.min);
    expect(summary.damageByCombatant).toHaveLength(sampleEncounter.combatants.length);
  }, 20000);

  it("expires conditions at the configured turn boundary", () => {
    const state = createEngineState(sampleEncounter);
    state.snapshot.round = 2;
    state.snapshot.turnIndex = 1;
    applyCondition(state, "pc-fighter", {
      id: "restrained-test",
      name: "restrained",
      startedRound: 1,
      expiresAt: { round: 2, turnIndex: 1, timing: "end" }
    });

    expireConditions(state, "start");
    expect(state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")?.conditions).toHaveLength(1);
    expireConditions(state, "end");
    expect(state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")?.conditions).toHaveLength(0);
  });

  it("prevents using the same action economy slot twice", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.map.walls = [];
    const firstTarget = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    const secondTarget = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-2");
    if (firstTarget) firstTarget.position = { x: 2, y: 1 };
    if (secondTarget) secondTarget.position = { x: 2, y: 2 };
    const action = encounter.definitions.find((definition) => definition.id === "def-fighter")?.actions[0];
    if (action?.kind === "attack") action.attackBonus = 100;
    const state = createEngineState(encounter);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");
    expect(() => resolveAttack(state, "pc-fighter", "enemy-goblin-2", "longsword")).toThrow(/already used/);
  });

  it("spends limited resources when an action is used", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.map.walls = [];
    const archer = encounter.combatants.find((combatant) => combatant.id === "pc-archer");
    if (archer) archer.resources = { "slot-1": 1 };
    encounter.definitions[1]?.actions.push({
      kind: "save",
      id: "guiding-bolt-standin",
      name: "Radiant Burst",
      actionType: "action",
      saveAbility: "dex",
      dc: 10,
      range: 80,
      damage: [{ dice: "1", damageType: "radiant" }],
      halfDamageOnSuccess: false,
      resourceCost: { resourceId: "slot-1", amount: 1 },
      automationSupport: "full"
    });
    const state = createEngineState(encounter);
    resolveSaveAction(state, "pc-archer", "enemy-goblin-1", "guiding-bolt-standin");
    expect(state.snapshot.combatants.find((combatant) => combatant.id === "pc-archer")?.resources?.["slot-1"]).toBe(0);
  });

  it("formats negative saving throw modifiers for save actions", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.map.walls = [];
    const target = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    if (target) target.position = { x: 2, y: 1 };
    const targetDefinition = encounter.definitions.find((definition) => definition.id === "def-goblin");
    if (targetDefinition) {
      targetDefinition.abilities.wis = 8;
      targetDefinition.saves = {};
    }
    const caster = encounter.definitions.find((definition) => definition.id === "def-fighter");
    if (caster) {
      caster.actions = [{
        kind: "save",
        id: "mind-jab",
        name: "Mind Jab",
        actionType: "action",
        saveAbility: "wis",
        dc: 10,
        range: 30,
        damage: [{ dice: "1", damageType: "psychic" }],
        halfDamageOnSuccess: false,
        automationSupport: "full"
      }];
    }

    const state = createEngineState(encounter);
    expect(() => resolveSaveAction(state, "pc-fighter", "enemy-goblin-1", "mind-jab")).not.toThrow();
    expect(state.log.find((entry) => entry.type === "SaveRolled")?.data?.saveRoll).toMatchObject({
      expression: "1d20-1"
    });
  });

  it("formats negative saving throw modifiers for area save actions", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.map.walls = [];
    const target = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    if (target) target.position = { x: 2, y: 1 };
    const targetDefinition = encounter.definitions.find((definition) => definition.id === "def-goblin");
    if (targetDefinition) {
      targetDefinition.abilities.wis = 8;
      targetDefinition.saves = {};
    }
    const caster = encounter.definitions.find((definition) => definition.id === "def-fighter");
    if (caster) {
      caster.actions = [{
        kind: "area-save",
        id: "mind-burst",
        name: "Mind Burst",
        actionType: "action",
        saveAbility: "wis",
        dc: 10,
        range: 30,
        area: { type: "circle", size: 10 },
        damage: [{ dice: "1", damageType: "psychic" }],
        halfDamageOnSuccess: false,
        affects: "hostile",
        automationSupport: "full"
      }];
    }

    const state = createEngineState(encounter);
    expect(() => resolveAreaSaveAction(state, "pc-fighter", { x: 2, y: 1 }, "mind-burst")).not.toThrow();
    expect(state.log.find((entry) => entry.type === "SaveRolled")?.data?.saveRoll).toMatchObject({
      expression: "1d20-1"
    });
  });

  it("spends resources and applies conditions for feature activation actions", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    const fighter = encounter.combatants.find((combatant) => combatant.id === "pc-fighter");
    if (fighter) fighter.resources = { rage: 1 };
    const definition = encounter.definitions.find((candidate) => candidate.id === "def-fighter");
    if (definition) {
      definition.features = [{
        id: "rage",
        name: "Rage",
        category: "feature",
        automationSupport: "partial"
      }];
      definition.bonusActions = [{
        kind: "activate-feature",
        id: "activate-rage",
        name: "Rage",
        actionType: "bonus",
        featureId: "rage",
        resourceCost: { resourceId: "rage", amount: 1 },
        condition: { id: "rage-active", name: "custom", durationRounds: 10 },
        automationSupport: "partial"
      }];
    }

    const state = createEngineState(encounter);
    const result = resolveActivateFeatureAction(state, "pc-fighter", "activate-rage");
    const actor = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter");
    expect(result.conditionId).toBe("rage-active");
    expect(actor?.resources?.rage).toBe(0);
    expect(actor?.actionEconomy?.bonus).toBe(false);
    expect(actor?.conditions?.[0]).toMatchObject({
      id: "rage-active",
      name: "custom",
      sourceId: "rage",
      expiresAt: { round: 10, turnIndex: 0, timing: "end" }
    });
  });

  it("automated barbarian uses Rage as a bonus action before attacking", () => {
    const parsed = parseCombatantPackage(JSON.parse(readFileSync("barbarian-template.json", "utf8")) as unknown);
    const barbarian = parsed.definition;
    const encounter: EncounterSnapshot = {
      ...structuredClone(sampleEncounter),
      seed: "barbarian-auto-rage",
      map: { ...structuredClone(sampleEncounter.map), walls: [] },
      definitions: [
        barbarian,
        {
          id: "def-target",
          name: "Target",
          source: { provider: "homebrew" },
          size: "medium",
          armorClass: 10,
          maxHp: 100,
          speed: 30,
          abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          actions: []
        }
      ],
      combatants: [
        {
          id: "barbarian",
          definitionId: barbarian.id,
          displayName: "Barbarian",
          faction: "party",
          position: { x: 1, y: 1 },
          currentHp: 65,
          tempHp: 0,
          resources: { rage: 4 },
          state: "active",
          tacticsProfile: "basic-melee"
        },
        {
          id: "target",
          definitionId: "def-target",
          displayName: "Target",
          faction: "enemy",
          position: { x: 2, y: 1 },
          currentHp: 100,
          tempHp: 0,
          state: "active",
          tacticsProfile: "basic-melee"
        }
      ]
    };

    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [10, 10], 12: [1, 1] });
    takeAutomatedTurn(state, state.snapshot.combatants[0]!);
    const actor = state.snapshot.combatants.find((combatant) => combatant.id === "barbarian");

    expect(actor?.resources?.rage).toBe(3);
    expect(actor?.conditions?.[0]).toMatchObject({ id: "rage-active", sourceId: "rage", sourceName: "Rage" });
    expect(actor?.actionEconomy).toMatchObject({ action: false, bonus: false });
    expect(state.log.some((entry) => entry.type === "AiDecision" && entry.data?.actionId === "activate-rage")).toBe(true);
  });

  it("applies active Rage bonus damage and temporary weapon resistances", () => {
    const parsed = parseCombatantPackage(JSON.parse(readFileSync("barbarian-template.json", "utf8")) as unknown);
    const barbarian = parsed.definition;
    const greataxe = barbarian.actions.find((action) => action.id === "greataxe-attack");
    if (greataxe?.kind !== "attack") throw new Error("missing greataxe attack");
    greataxe.attackBonus = 100;
    greataxe.damage = [{ dice: "1", damageType: "slashing", abilityModifier: "str", bonusFormula: { base: 1 } }];

    const encounter: EncounterSnapshot = {
      ...structuredClone(sampleEncounter),
      seed: "barbarian-rage-effects",
      map: { ...structuredClone(sampleEncounter.map), walls: [] },
      definitions: [
        barbarian,
        {
          id: "def-attacker",
          name: "Attacker",
          source: { provider: "homebrew" },
          size: "medium",
          armorClass: 10,
          maxHp: 100,
          speed: 30,
          abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          actions: [{
            kind: "attack",
            id: "club",
            name: "Club",
            actionType: "action",
            attackType: "melee",
            ability: "str",
            attackBonus: 100,
            range: 5,
            reach: 5,
            damage: [{ dice: "9", damageType: "slashing" }],
            automationSupport: "full"
          }]
        }
      ],
      combatants: [
        {
          id: "barbarian",
          definitionId: barbarian.id,
          displayName: "Barbarian",
          faction: "party",
          position: { x: 1, y: 1 },
          currentHp: 65,
          tempHp: 0,
          resources: { rage: 1 },
          state: "active",
          tacticsProfile: "basic-melee"
        },
        {
          id: "attacker",
          definitionId: "def-attacker",
          displayName: "Attacker",
          faction: "enemy",
          position: { x: 2, y: 1 },
          currentHp: 100,
          tempHp: 0,
          state: "active",
          tacticsProfile: "basic-melee"
        }
      ]
    };

    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [10, 10] });
    resolveActivateFeatureAction(state, "barbarian", "activate-rage");
    const attack = resolveAttack(state, "barbarian", "attacker", "greataxe-attack");
    resolveAttack(state, "attacker", "barbarian", "club");

    expect(attack.damageApplied).toBe(8);
    expect(state.log.find((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "barbarian")?.data?.appliedDamageEffects).toContain("Rage");
    expect(state.snapshot.combatants.find((combatant) => combatant.id === "barbarian")?.currentHp).toBe(61);
  });

  it("derives attack bonuses from ability and proficiency formulas", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "derived-attack-bonus";
    encounter.map.walls = [];
    const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter");
    if (fighter) {
      fighter.proficiencyBonus = 4;
      fighter.abilities.str = 18;
      fighter.actions = [{
        kind: "attack",
        id: "formula-sword",
        name: "Formula Sword",
        actionType: "action",
        attackType: "melee",
        ability: "str",
        attackBonusFormula: { ability: "str", proficiency: true },
        range: 5,
        reach: 5,
        damage: [{ dice: "1", damageType: "slashing", abilityModifier: "str" }],
        automationSupport: "full"
      }];
    }
    const target = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    if (target) {
      target.position = { x: 2, y: 1 };
      target.currentHp = 20;
    }

    const state = createEngineState(encounter);
    const result = resolveAttack(state, "pc-fighter", "enemy-goblin-1", "formula-sword");
    expect(result.total - result.attackRoll.total).toBe(8);
    expect(state.log.find((entry) => entry.type === "AttackRolled")?.data?.attackBonus).toBe(8);
  });

  it("resolves multiattack as repeated child attacks without spending extra action slots", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "multiattack";
    encounter.map.walls = [];
    const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter");
    if (fighter) {
      fighter.actions = [
        {
          kind: "attack",
          id: "claw",
          name: "Claw",
          actionType: "action",
          attackType: "melee",
          ability: "str",
          attackBonus: 100,
          range: 5,
          reach: 5,
          damage: [{ dice: "1", damageType: "slashing" }],
          automationSupport: "full"
        },
        {
          kind: "multiattack",
          id: "two-claws",
          name: "Two Claws",
          actionType: "action",
          attacks: [{ actionId: "claw", count: 2 }],
          automationSupport: "full"
        }
      ];
    }
    const target = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    if (target) {
      target.position = { x: 2, y: 1 };
      target.currentHp = 20;
    }

    const state = createEngineState(encounter);
    const result = resolveMultiattackAction(state, "pc-fighter", "enemy-goblin-1", "two-claws");
    expect(result.attacks).toHaveLength(2);
    expect(state.snapshot.combatants.find((combatant) => combatant.id === "enemy-goblin-1")?.currentHp).toBe(18);
    expect(state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")?.actionEconomy?.action).toBe(false);
  });

  it("splits a multiattack across several targets by targetGroup and spills off a dead one", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "split-multiattack";
    encounter.map.walls = [];
    const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter");
    if (fighter) {
      fighter.actions = [
        {
          kind: "attack", id: "swing", name: "Swing", actionType: "action", attackType: "melee",
          ability: "str", attackBonus: 100, range: 5, reach: 5,
          damage: [{ dice: "1", damageType: "slashing" }], automationSupport: "full"
        },
        {
          kind: "multiattack", id: "triple", name: "Triple Swing", actionType: "action",
          attacks: [
            { actionId: "swing", count: 1, targetGroup: 0 },
            { actionId: "swing", count: 1, targetGroup: 1 },
            { actionId: "swing", count: 1, targetGroup: 2 }
          ],
          automationSupport: "full"
        }
      ];
    }
    const goblin1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1");
    const goblin2 = encounter.combatants.find((c) => c.id === "enemy-goblin-2");
    if (goblin1) { goblin1.position = { x: 2, y: 1 }; goblin1.currentHp = 1; }
    if (goblin2) { goblin2.position = { x: 2, y: 2 }; goblin2.currentHp = 20; }

    const state = createEngineState(encounter);
    // targetGroup 2 has no id → clamps to the last supplied target (goblin-2)
    const result = resolveMultiattackAction(state, "pc-fighter", ["enemy-goblin-1", "enemy-goblin-2"], "triple");

    expect(result.attacks).toHaveLength(3);
    const g1 = state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1");
    const g2 = state.snapshot.combatants.find((c) => c.id === "enemy-goblin-2");
    // step 0 drops goblin-1 (1 HP, 1 dmg); steps 1 and 2 both land on goblin-2
    expect(g1?.currentHp).toBeLessThanOrEqual(0);
    expect(g2?.currentHp).toBe(18);
    const resolved = state.log.find((entry) => entry.type === "MultiattackResolved");
    expect(resolved?.data?.targetIds).toEqual(["enemy-goblin-1", "enemy-goblin-2"]);
  });

  it("accepts a single target id for multiattack (back-compat)", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "single-multiattack";
    encounter.map.walls = [];
    const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter");
    if (fighter) {
      fighter.actions = [
        {
          kind: "attack", id: "claw", name: "Claw", actionType: "action", attackType: "melee",
          ability: "str", attackBonus: 100, range: 5, reach: 5,
          damage: [{ dice: "1", damageType: "slashing" }], automationSupport: "full"
        },
        {
          kind: "multiattack", id: "two-claws", name: "Two Claws", actionType: "action",
          attacks: [{ actionId: "claw", count: 2 }], automationSupport: "full"
        }
      ];
    }
    const target = encounter.combatants.find((c) => c.id === "enemy-goblin-1");
    if (target) { target.position = { x: 2, y: 1 }; target.currentHp = 20; }
    const state = createEngineState(encounter);
    const result = resolveMultiattackAction(state, "pc-fighter", "enemy-goblin-1", "two-claws");
    expect(result.attacks).toHaveLength(2);
    expect(state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")?.currentHp).toBe(18);
  });

  it("applies Pack Tactics as a real attack advantage trait", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "pack-tactics";
    encounter.map.walls = [];
    const goblin = encounter.definitions.find((definition) => definition.id === "def-goblin");
    if (goblin) {
      goblin.traits = [{
        id: "pack-tactics",
        name: "Pack Tactics",
        category: "trait",
        automationSupport: "full",
        effects: [{
          kind: "attack-advantage",
          condition: "ally-adjacent-to-target"
        }]
      }];
      const attack = goblin.actions.find((action) => action.kind === "attack");
      if (attack?.kind === "attack") attack.attackBonus = 100;
    }
    const attacker = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    const ally = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-2");
    const target = encounter.combatants.find((combatant) => combatant.id === "pc-fighter");
    if (attacker) attacker.position = { x: 2, y: 1 };
    if (ally) ally.position = { x: 1, y: 2 };
    if (target) target.position = { x: 1, y: 1 };

    const state = createEngineState(encounter);
    const result = resolveAttack(state, "enemy-goblin-1", "pc-fighter", "scimitar");
    expect(result.attackRoll.rolls).toHaveLength(2);
    expect(state.log.find((entry) => entry.type === "AttackRolled")?.data?.appliedAttackEffects).toContain("Pack Tactics");
  });

  it("attack-advantage with mode 'disadvantage' rolls the attacker's d20 twice and keeps the low one", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "feature-disadvantage";
    encounter.map.walls = [];
    const goblin = encounter.definitions.find((d) => d.id === "def-goblin")!;
    goblin.traits = [{
      id: "clumsy", name: "Clumsy", category: "trait", automationSupport: "full",
      effects: [{ kind: "attack-advantage", condition: "always", mode: "disadvantage" }]
    }];
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 2, y: 1 };
    encounter.combatants.find((c) => c.id === "pc-fighter")!.position = { x: 1, y: 1 };
    const state = createEngineState(encounter);
    const result = resolveAttack(state, "enemy-goblin-1", "pc-fighter", "scimitar");
    expect(result.attackRoll.rolls.length).toBe(2);
    expect(state.log.find((e) => e.type === "AttackRolled")?.data?.rollMode).toBe("disadvantage");
  });

  it("incoming-attack-modifier on the target shifts attack rolls made against it", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "incoming-mod";
    encounter.map.walls = [];
    const fighter = encounter.definitions.find((d) => d.id === "def-fighter")!;
    fighter.traits = [{
      id: "bulwark", name: "Bulwark", category: "trait", automationSupport: "full",
      effects: [{ kind: "incoming-attack-modifier", condition: "always", amount: -5 }]
    }];
    const goblin = encounter.definitions.find((d) => d.id === "def-goblin")!;
    (goblin.actions.find((a) => a.kind === "attack") as { attackBonus?: number }).attackBonus = 10;
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 2, y: 1 };
    encounter.combatants.find((c) => c.id === "pc-fighter")!.position = { x: 1, y: 1 };
    encounter.combatants.find((c) => c.id === "pc-fighter")!.currentHp = 40;
    const state = createEngineState(encounter);
    state.rng = { next: () => 0, nextInt: () => 12, fork() { return this; } };
    const result = resolveAttack(state, "enemy-goblin-1", "pc-fighter", "scimitar");
    // 12 + 10 - 5 = 17 vs the fighter's AC 16 → still hits; total reflects the -5
    expect(state.log.find((e) => e.type === "AttackRolled")?.data?.total).toBe(17);
    void result;
  });

  it("extra-action can refresh the reaction slot; resource-regain on-activate tops up a pool", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "extra-reaction";
    encounter.map.walls = [];
    const fighter = encounter.definitions.find((d) => d.id === "def-fighter")!;
    fighter.features = [{
      id: "war-caster", name: "War Caster", category: "feature", automationSupport: "full",
      effects: [
        { kind: "extra-action", slot: "reaction" },
        { kind: "resource-regain", timing: "on-activate", resourceId: "focus", amount: { base: 2 }, max: 3 }
      ]
    }];
    fighter.actions.push({
      kind: "activate-feature", id: "channel", name: "Channel", actionType: "free", featureId: "war-caster",
      automationSupport: "full"
    });
    const combatant = encounter.combatants.find((c) => c.id === "pc-fighter")!;
    combatant.actionEconomy = { action: true, bonus: true, reaction: false };
    combatant.resources = { focus: 0 };
    const state = createEngineState(encounter);
    resolveActivateFeatureAction(state, "pc-fighter", "channel");
    const after = state.snapshot.combatants.find((c) => c.id === "pc-fighter")!;
    expect(after.actionEconomy?.reaction).toBe(true);
    expect(after.resources?.focus).toBe(2);
  });

  it("applies Swarm as real trait damage that scales when bloodied", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "swarm-damage";
    encounter.map.walls = [];
    const goblin = encounter.definitions.find((definition) => definition.id === "def-goblin");
    if (goblin) {
      goblin.maxHp = 20;
      goblin.traits = [{
        id: "swarm",
        name: "Swarm",
        category: "trait",
        automationSupport: "full",
        effects: [{
          kind: "swarm-damage",
          fullHpDamage: [{ dice: "2", damageType: "piercing" }],
          bloodiedDamage: [{ dice: "1", damageType: "piercing" }]
        }]
      }];
      const attack = goblin.actions.find((action) => action.kind === "attack");
      if (attack?.kind === "attack") {
        attack.attackBonus = 100;
        attack.damage = [{ dice: "1", damageType: "piercing" }];
      }
    }
    const attacker = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    const target = encounter.combatants.find((combatant) => combatant.id === "pc-fighter");
    if (attacker) {
      attacker.position = { x: 2, y: 1 };
      attacker.currentHp = 20;
    }
    if (target) {
      target.position = { x: 1, y: 1 };
      target.currentHp = 32;
    }

    const fullState = createEngineState(encounter);
    const full = resolveAttack(fullState, "enemy-goblin-1", "pc-fighter", "scimitar");
    expect(full.damageApplied).toBe(3);

    if (attacker) attacker.currentHp = 10;
    if (target) target.currentHp = 32;
    const bloodiedState = createEngineState(encounter);
    const bloodied = resolveAttack(bloodiedState, "enemy-goblin-1", "pc-fighter", "scimitar");
    expect(bloodied.damageApplied).toBe(2);
  });

  it("applies assassin sneak attack once per turn and poisoned weapon damage on each hit", () => {
    const parsed = parseCombatantPackage(JSON.parse(readFileSync("assassin.json", "utf8")) as unknown);
    const assassin = parsed.definition;
    const shortsword = assassin.actions.find((action) => action.id === "shortsword-attack");
    if (shortsword?.kind !== "attack") throw new Error("missing shortsword attack");
    shortsword.attackBonus = 100;
    shortsword.damage = [{ dice: "1", damageType: "piercing" }];

    const encounter: EncounterSnapshot = {
      ...structuredClone(sampleEncounter),
      seed: "assassin-effects",
      map: { ...structuredClone(sampleEncounter.map), walls: [] },
      definitions: [
        assassin,
        {
          id: "def-target",
          name: "Target",
          source: { provider: "homebrew" },
          size: "medium",
          armorClass: 10,
          maxHp: 100,
          speed: 30,
          saves: { con: 0 },
          abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          actions: []
        }
      ],
      combatants: [
        {
          id: "assassin",
          definitionId: assassin.id,
          displayName: "Assassin",
          faction: "enemy",
          position: { x: 1, y: 1 },
          currentHp: 78,
          tempHp: 0,
          state: "active",
          tacticsProfile: "basic-melee"
        },
        {
          id: "target",
          definitionId: "def-target",
          displayName: "Target",
          faction: "party",
          position: { x: 2, y: 1 },
          currentHp: 100,
          tempHp: 0,
          state: "active",
          tacticsProfile: "basic-melee"
        }
      ]
    };

    const state = createEngineState(encounter);
    state.rng = scriptedRng({
      20: [10, 10, 1, 10, 10, 1],
      6: Array.from({ length: 18 }, () => 1)
    });
    const result = resolveMultiattackAction(state, "assassin", "target", "assassin-multiattack", { advantage: true });

    expect(result.attacks.map((attack) => attack.damageApplied)).toEqual([12, 8]);
    expect(state.snapshot.combatants.find((combatant) => combatant.id === "target")?.currentHp).toBe(80);
    expect(state.log.filter((entry) => entry.type === "FeatureEffectApplied" && entry.data?.featureId === "sneak-attack")).toHaveLength(1);
    expect(state.log.filter((entry) => entry.type === "FeatureEffectApplied" && entry.data?.featureId === "poisoned-weapons")).toHaveLength(2);
    expect(state.log.filter((entry) => entry.type === "SaveRolled" && entry.data?.featureId === "poisoned-weapons")).toHaveLength(2);
  });

  it("halves assassin poisoned weapon damage on a successful Constitution save", () => {
    const parsed = parseCombatantPackage(JSON.parse(readFileSync("assassin.json", "utf8")) as unknown);
    const assassin = parsed.definition;
    const shortsword = assassin.actions.find((action) => action.id === "shortsword-attack");
    if (shortsword?.kind !== "attack") throw new Error("missing shortsword attack");
    shortsword.attackBonus = 100;
    shortsword.damage = [{ dice: "0", damageType: "piercing" }];

    const encounter: EncounterSnapshot = {
      ...structuredClone(sampleEncounter),
      seed: "assassin-poison-save",
      map: { ...structuredClone(sampleEncounter.map), walls: [] },
      definitions: [
        assassin,
        {
          id: "def-target",
          name: "Target",
          source: { provider: "homebrew" },
          size: "medium",
          armorClass: 10,
          maxHp: 100,
          speed: 30,
          saves: { con: 100 },
          abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          actions: []
        }
      ],
      combatants: [
        {
          id: "assassin",
          definitionId: assassin.id,
          displayName: "Assassin",
          faction: "enemy",
          position: { x: 1, y: 1 },
          currentHp: 78,
          tempHp: 0,
          state: "active",
          tacticsProfile: "basic-melee"
        },
        {
          id: "target",
          definitionId: "def-target",
          displayName: "Target",
          faction: "party",
          position: { x: 2, y: 1 },
          currentHp: 100,
          tempHp: 0,
          state: "active",
          tacticsProfile: "basic-melee"
        }
      ]
    };

    const state = createEngineState(encounter);
    state.rng = scriptedRng({
      20: [10, 10],
      6: Array.from({ length: 7 }, () => 2)
    });
    const result = resolveAttack(state, "assassin", "target", "shortsword-attack");
    const save = state.log.find((entry) => entry.type === "SaveRolled" && entry.data?.featureId === "poisoned-weapons");

    expect(result.damageApplied).toBe(7);
    expect(save?.data?.success).toBe(true);
    expect(state.snapshot.combatants.find((combatant) => combatant.id === "target")?.currentHp).toBe(93);
  });

  it("applies and consumes Death's Brand from Spiritbound Marksman shots", () => {
    const parsed = parseCombatantPackage(JSON.parse(readFileSync("spirit-marksman.json", "utf8")) as unknown);
    const marksman = parsed.definition;
    const shot = marksman.actions.find((action) => action.id === "spiritfire-shot");
    if (shot?.kind !== "attack") throw new Error("missing Spiritfire Gun shot");
    shot.attackBonus = 100;
    shot.damage = [{ dice: "1", damageType: "force" }];

    const encounter: EncounterSnapshot = {
      ...structuredClone(sampleEncounter),
      seed: "spirit-marksman-brand",
      map: { ...structuredClone(sampleEncounter.map), walls: [] },
      definitions: [
        marksman,
        {
          id: "def-target",
          name: "Target",
          source: { provider: "homebrew" },
          size: "medium",
          armorClass: 10,
          maxHp: 100,
          speed: 30,
          abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          actions: []
        }
      ],
      combatants: [
        {
          id: "marksman",
          definitionId: marksman.id,
          displayName: "Spiritbound Marksman",
          faction: "party",
          position: { x: 1, y: 1 },
          currentHp: 45,
          tempHp: 0,
          resources: { "second-deaths-brand": 1 },
          state: "active",
          tacticsProfile: "basic-ranged"
        },
        {
          id: "target",
          definitionId: "def-target",
          displayName: "Target",
          faction: "enemy",
          position: { x: 2, y: 1 },
          currentHp: 100,
          tempHp: 0,
          state: "active",
          tacticsProfile: "basic-melee"
        }
      ]
    };

    const state = createEngineState(encounter);
    state.rng = scriptedRng({
      20: [10, 10],
      6: [1, 1]
    });
    const result = resolveMultiattackAction(state, "marksman", "target", "spiritfire-gun-attack");
    const target = state.snapshot.combatants.find((combatant) => combatant.id === "target");

    expect(result.attacks.map((attack) => attack.damageApplied)).toEqual([5, 7]);
    expect(target?.currentHp).toBe(88);
    expect(target?.conditions ?? []).toHaveLength(0);
    expect(state.log.filter((entry) => entry.type === "FeatureEffectApplied" && entry.data?.featureId === "deaths-brand")).toHaveLength(2);
    expect(state.log.some((entry) => entry.type === "ConditionExpired" && entry.data?.reason === "consumed")).toBe(true);
    expect(state.log.find((entry) => entry.type === "AttackRolled" && entry.data?.actionId === "spiritfire-shot")?.data?.appliedConditionEffects).toContain("Death's Brand");
  });

  it("uses condition AC modifiers during attack resolution", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "condition-ac";
    encounter.map.walls = [];
    const target = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    if (target) {
      target.position = { x: 2, y: 1 };
      target.conditions = [{
        id: "shield",
        name: "custom",
        startedRound: 0,
        modifiers: { armorClass: 10 }
      }];
    }
    const action = encounter.definitions.find((definition) => definition.id === "def-fighter")?.actions[0];
    if (action?.kind === "attack") action.attackBonus = 0;
    const state = createEngineState(encounter);
    const result = resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");
    expect(result.targetAc).toBe(25);
  });

  it("checks and drops concentration after damage", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.map.walls = [];
    const target = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    if (target) {
      target.position = { x: 2, y: 1 };
      target.currentHp = 200;
      target.concentration = { sourceConditionId: "bless" };
      target.conditions = [{ id: "bless", name: "custom", startedRound: 0 }];
    }
    const action = encounter.definitions.find((definition) => definition.id === "def-fighter")?.actions[0];
    if (action?.kind === "attack") {
      action.attackBonus = 100;
      action.damage = [{ dice: "100", damageType: "slashing" }];
    }
    const state = createEngineState(encounter);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");
    const damaged = state.snapshot.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    expect(damaged?.concentration).toBeUndefined();
    expect(damaged?.conditions?.some((condition) => condition.id === "bless")).toBe(false);
  });

  it("formats negative concentration save modifiers", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.map.walls = [];
    const target = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    const targetDefinition = encounter.definitions.find((definition) => definition.id === "def-goblin");
    if (target) {
      target.position = { x: 2, y: 1 };
      target.currentHp = 200;
      target.concentration = { sourceConditionId: "hex" };
      target.conditions = [{ id: "hex", name: "custom", startedRound: 0 }];
    }
    if (targetDefinition) {
      targetDefinition.abilities.con = 8;
      targetDefinition.saves = {};
    }
    const action = encounter.definitions.find((definition) => definition.id === "def-fighter")?.actions[0];
    if (action?.kind === "attack") {
      action.attackBonus = 100;
      action.damage = [{ dice: "1", damageType: "slashing" }];
    }

    const state = createEngineState(encounter);
    expect(() => resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword")).not.toThrow();
    expect(state.log.find((entry) => entry.type === "ConcentrationChecked")?.data?.roll).toMatchObject({
      expression: "1d20-1"
    });
  });
});
