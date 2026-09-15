import { describe, expect, it } from "vitest";
import { createEngineState, moveCombatant, resolveAreaSaveAction, resolveAttack, resolveSaveAction, sampleEncounter, updateDefeatState } from "@/engine";
import type { EncounterSnapshot, FeatureDefinition } from "@/engine";

/**
 * `aura`-tagged features (Aura of Protection) radiate their `effects` to
 * OTHER nearby combatants via `auraSources` (src/engine/combat.ts), merged
 * into `featureSaveModifier` / `featureSaveAdvantageModifier` /
 * `effectiveArmorClass` alongside each combatant's own `featureSources`.
 * There is no persisted "am I buffed" state — it's recomputed live on every
 * save/AC read — so these tests exercise it through several different call
 * sites rather than a single helper, to prove the merge landed everywhere
 * it needs to.
 */
const auraOfProtection: FeatureDefinition = {
  id: "test:aura-of-protection",
  name: "Aura of Protection",
  category: "trait",
  automationSupport: "full",
  aura: { range: 10, affects: "allies", requiresConscious: true },
  effects: [{ kind: "save-bonus", bonus: { ability: "cha" } }]
};

function auraEncounter(affects: "allies" | "all" | "hostile" = "allies"): EncounterSnapshot {
  const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
  encounter.map.walls = [];
  encounter.map.terrain = [];
  const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
  fighter.abilities.cha = 16; // +3 modifier
  fighter.traits = [{ ...auraOfProtection, aura: { ...auraOfProtection.aura!, affects } }];
  fighter.actions.push({
    kind: "save",
    id: "test-save-spell",
    name: "Test Save Spell",
    actionType: "action",
    saveAbility: "con",
    dc: 10,
    range: 80,
    damage: [{ dice: "1", damageType: "force" }],
    halfDamageOnSuccess: false,
    affects: "all",
    automationSupport: "full"
  } as never);
  const goblin1 = encounter.definitions.find((definition) => definition.id === "def-goblin")!;
  goblin1.actions.push({
    kind: "save",
    id: "goblin-save-spell",
    name: "Goblin Hex",
    actionType: "action",
    saveAbility: "con",
    dc: 10,
    range: 80,
    damage: [{ dice: "1", damageType: "necrotic" }],
    halfDamageOnSuccess: false,
    affects: "all",
    automationSupport: "full"
  } as never);
  goblin1.actions.push({
    kind: "area-save",
    id: "goblin-blast",
    name: "Goblin Blast",
    actionType: "action",
    saveAbility: "con",
    dc: 10,
    range: 60,
    area: { type: "circle", size: 10 },
    targeting: { origin: "point", range: 60 },
    damage: [{ dice: "1", damageType: "poison" }],
    halfDamageOnSuccess: true,
    onSuccess: "half",
    affects: "all",
    automationSupport: "full"
  } as never);
  goblin1.actions.push({
    kind: "area-save",
    id: "goblin-zone",
    name: "Goblin Zone",
    actionType: "action",
    saveAbility: "con",
    dc: 10,
    range: 60,
    area: { type: "circle", size: 10 },
    targeting: { origin: "point", range: 60 },
    damage: [{ dice: "1", damageType: "poison" }],
    halfDamageOnSuccess: true,
    onSuccess: "half",
    affects: "all",
    zone: { duration: { kind: "rounds", rounds: 5 }, trigger: ["on-enter"], anchor: "fixed" },
    automationSupport: "full"
  } as never);

  const fighterCombatant = encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!;
  fighterCombatant.position = { x: 1, y: 1 };
  const archer = encounter.combatants.find((combatant) => combatant.id === "pc-archer")!;
  archer.position = { x: 2, y: 1 }; // 5 ft from the fighter — inside the 10 ft aura
  const goblin = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!;
  goblin.position = { x: 1, y: 2 }; // adjacent to the fighter, but not an ally
  return encounter;
}

function appliedSaveEffects(state: ReturnType<typeof createEngineState>, targetId = "pc-archer") {
  return state.log.filter((entry) => entry.type === "SaveRolled" && entry.data?.targetId === targetId)
    .at(-1)?.data?.appliedSaveEffects as string[] | undefined;
}

describe("aura-tagged features (buff auras)", () => {
  it("buffs an ally's saving throw while within range", () => {
    const state = createEngineState(auraEncounter());
    resolveSaveAction(state, "enemy-goblin-1", "pc-archer", "goblin-save-spell");

    expect(appliedSaveEffects(state)).toContain("Aura of Protection");
  });

  it("does not buff an ally beyond range", () => {
    const encounter = auraEncounter();
    encounter.combatants.find((combatant) => combatant.id === "pc-archer")!.position = { x: 10, y: 1 }; // 45 ft away
    const state = createEngineState(encounter);
    resolveSaveAction(state, "enemy-goblin-1", "pc-archer", "goblin-save-spell");

    expect(appliedSaveEffects(state) ?? []).not.toContain("Aura of Protection");
  });

  it("affects: \"hostile\" reaches only enemies within range, never the bearer's own allies", () => {
    const state = createEngineState(auraEncounter("hostile"));
    resolveSaveAction(state, "pc-fighter", "enemy-goblin-1", "test-save-spell");
    expect(appliedSaveEffects(state, "enemy-goblin-1")).toContain("Aura of Protection");

    resolveSaveAction(state, "enemy-goblin-1", "pc-archer", "goblin-save-spell");
    expect(appliedSaveEffects(state, "pc-archer") ?? []).not.toContain("Aura of Protection");
  });

  it("affects: \"all\" reaches both allies and enemies within range", () => {
    const state = createEngineState(auraEncounter("all"));
    resolveSaveAction(state, "enemy-goblin-1", "pc-archer", "goblin-save-spell");
    expect(appliedSaveEffects(state, "pc-archer")).toContain("Aura of Protection");

    resolveSaveAction(state, "pc-fighter", "enemy-goblin-1", "test-save-spell");
    expect(appliedSaveEffects(state, "enemy-goblin-1")).toContain("Aura of Protection");
  });

  it("never buffs an opposing-faction combatant, even standing adjacent to the bearer", () => {
    const state = createEngineState(auraEncounter());
    resolveSaveAction(state, "pc-fighter", "enemy-goblin-1", "test-save-spell");

    expect(appliedSaveEffects(state, "enemy-goblin-1") ?? []).not.toContain("Aura of Protection");
  });

  it("buffs the bearer's own saving throw", () => {
    const state = createEngineState(auraEncounter());
    resolveSaveAction(state, "enemy-goblin-1", "pc-fighter", "goblin-save-spell");

    expect(appliedSaveEffects(state, "pc-fighter")).toContain("Aura of Protection");
  });

  it("stops applying the instant the bearer is downed — no explicit teardown, just a live gate", () => {
    const state = createEngineState(auraEncounter());
    const fighter = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    fighter.currentHp = 0;
    updateDefeatState(state, fighter);

    resolveSaveAction(state, "enemy-goblin-1", "pc-archer", "goblin-save-spell");

    expect(appliedSaveEffects(state) ?? []).not.toContain("Aura of Protection");
  });

  it("boosts an ally's save against an area-save blast (resolveAreaSaveAction path)", () => {
    const state = createEngineState(auraEncounter());
    // The archer sits at (2,1) — aim the blast there, still within 10 ft of the fighter's aura.
    resolveAreaSaveAction(state, "enemy-goblin-1", { x: 2, y: 1 }, "goblin-blast");

    expect(appliedSaveEffects(state, "pc-archer")).toContain("Aura of Protection");
  });

  it("boosts an ally's save against a hostile zone (applyZoneEffect path)", () => {
    const state = createEngineState(auraEncounter());
    // Plant the zone away from anyone, then walk the archer (near the fighter) into it.
    resolveAreaSaveAction(state, "enemy-goblin-1", { x: 3, y: 1 }, "goblin-zone");

    moveCombatant(state, "pc-archer", { x: 3, y: 1 });

    const zoneSave = state.log.filter((entry) => entry.type === "SaveRolled" && entry.data?.viaZone).at(-1);
    expect(zoneSave?.data?.appliedSaveEffects).toContain("Aura of Protection");
  });

  it("boosts the bearer's own concentration check (resolveConcentration path)", () => {
    const encounter = auraEncounter();
    const fighterDefinition = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
    fighterDefinition.maxHp = 500;
    const fighterCombatant = encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    fighterCombatant.currentHp = 500;
    fighterCombatant.concentration = {};
    const goblinAction = encounter.definitions.find((definition) => definition.id === "def-goblin")?.actions[0];
    if (goblinAction?.kind === "attack") {
      goblinAction.attackBonus = 100;
      goblinAction.damage = [{ dice: "10", damageType: "piercing" }];
    }
    const state = createEngineState(encounter);

    resolveAttack(state, "enemy-goblin-1", "pc-fighter", goblinAction!.id);

    const check = state.log.filter((entry) => entry.type === "ConcentrationChecked").at(-1);
    expect(check?.data?.appliedSaveEffects).toContain("Aura of Protection");
  });

  it("stacks two auras from two different bearers instead of capping at one", () => {
    const encounter = auraEncounter();
    const archerDefinition = encounter.definitions.find((definition) => definition.id === "def-archer")!;
    archerDefinition.abilities.cha = 14; // +2 modifier
    archerDefinition.traits = [{ ...auraOfProtection, id: "test:aura-of-protection-2" }];
    // The archer already sits 5 ft from the fighter (auraEncounter) — within
    // both auras' 10 ft range, so the fighter now benefits from their own
    // aura (self-inclusion) AND the archer's.
    const state = createEngineState(encounter);

    resolveSaveAction(state, "enemy-goblin-1", "pc-fighter", "goblin-save-spell");

    const entry = state.log.filter((logEntry) => logEntry.type === "SaveRolled").at(-1);
    expect(entry?.data?.appliedSaveEffects).toEqual(["Aura of Protection", "Aura of Protection"]);
    expect(entry?.data?.featureSaveBonus).toBe(5); // fighter's own +3 CHA aura + the archer's +2 CHA aura
  });
});
