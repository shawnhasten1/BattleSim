import { describe, expect, it } from "vitest";
import {
  castLevelOf,
  createEngineState,
  creatureDefinitionSchema,
  getExecutableActions,
  resolveAttack,
  resolveSaveAction,
  sampleEncounter,
  spellcastingAbility,
  type ActionDefinition,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { runAutomatedEncounter } from "@/engine/turns";
import { SRD_2014_CATALOG } from "@/data/srd/2014";
import {
  backgroundDefinitionSchema,
  blankCharacter,
  buildCharacter,
  classDefinitionSchema,
  featDefinitionSchema,
  quickBuild,
  readBuild,
  rebuildActor,
  speciesDefinitionSchema,
  subclassDefinitionSchema,
  withChoice,
  withLevelUp,
  withSuggestions
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES, SRD_BUILDER_LIBRARY } from "@/lib/character-builder/srd";
import { builtFrom } from "@/lib/character-builder/summary";
import { editionOf } from "@/lib/editions";

/** EDITIONS_PLAN.md Phases 6 to 9: the 2014 catalog, built and fought with. */

const sources = SRD_BUILD_SOURCES;

describe("the 2014 catalog", () => {
  it("passes the catalog's schemas, each entry coming back exactly as it went in", () => {
    const roundTrips = (schema: { parse(value: unknown): unknown }, entries: Array<{ id: string }>) => {
      for (const entry of entries) {
        const json = JSON.parse(JSON.stringify(entry));
        expect(schema.parse(json), entry.id).toEqual(json);
      }
    };
    roundTrips(classDefinitionSchema, SRD_2014_CATALOG.classes);
    roundTrips(subclassDefinitionSchema, SRD_2014_CATALOG.subclasses);
    roundTrips(featDefinitionSchema, SRD_2014_CATALOG.feats);
    roundTrips(backgroundDefinitionSchema, SRD_2014_CATALOG.backgrounds);
    roundTrips(speciesDefinitionSchema, SRD_2014_CATALOG.species);
  });

  it("is all 2014, under ids that never meet a 2024 entry's, in the builder beside the 2024 catalog", () => {
    const { classes, subclasses, feats, backgrounds, species } = SRD_2014_CATALOG;
    for (const entry of [...classes, ...subclasses, ...feats, ...backgrounds, ...species]) {
      expect(entry.edition, entry.id).toBe("2014");
      expect(editionOf(entry.source), entry.id).toBe("2014");
      expect(entry.id, entry.id).toMatch(/-2014$/);
      expect(sources.catalog[classes.includes(entry as never) ? "classes" : subclasses.includes(entry as never) ? "subclasses" : feats.includes(entry as never) ? "feats" : backgrounds.includes(entry as never) ? "backgrounds" : "species"].some((candidate: { id: string }) => candidate.id === entry.id)).toBe(true);
    }
    for (const subclass of subclasses) expect(classes.some((entry) => entry.id === subclass.classId), subclass.id).toBe(true);
  });

  it("levels every 2014 class from 1 to 20 into a valid actor, which the AI fights with using only legal actions", { timeout: 180000 }, () => {
    const problems: string[] = [];
    for (const definition of SRD_2014_CATALOG.classes) {
      let build = quickBuild(sources, { classId: definition.id, level: 1 });
      let actor = rebuildActor(blankCharacter("def-fighter", definition.name), build, sources).definition;
      for (let level = 1; level <= 20; level += 1) {
        if (level > 1) {
          build = withSuggestions(withLevelUp(readBuild(actor)!), sources);
          actor = rebuildActor(actor, build, sources).definition;
        }
        const built = buildCharacter(build, sources);
        for (const warning of built.warnings) problems.push(`${definition.id} ${level}: ${warning}`);
        const parsed = creatureDefinitionSchema.safeParse(actor);
        if (!parsed.success) problems.push(`${definition.id} ${level}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
        if (level % 4 !== 1 && level !== 20) continue;
        const snapshot = structuredClone(sampleEncounter);
        snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), actor];
        for (const token of snapshot.combatants) {
          if (token.id === "pc-fighter") { token.currentHp = actor.maxHp; token.resources = { ...(actor.resources ?? {}) }; }
        }
        const result = runAutomatedEncounter({ ...snapshot, seed: `${definition.id}-${level}` }, 6);
        for (const warning of result.outcome.warnings) problems.push(`${definition.id} ${level}: ${warning}`);
      }
      // No Epic Boon: its 19th level is an Ability Score Improvement.
      expect(buildCharacter(readBuild(actor)!, sources).choices.some((slot) => slot.spec.id === "epic-boon"), definition.id).toBe(false);
    }
    expect(problems).toEqual([]);
  });
});

describe("the first 2014 characters (Phase 6)", () => {
  it("a 2014 Fighter 5, Hill Dwarf, Acolyte: the race's increases, the 2014 features, the line-by-line equipment", () => {
    let build = quickBuild(sources, { classId: "srd:class:fighter-2014", level: 5, backgroundId: "srd:background:acolyte-2014", speciesId: "srd:species:dwarf-2014", abilities: { method: "standard-array", base: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } } });
    build = withChoice(build, { kind: "species" }, ["subrace"], ["hill-dwarf"]);
    const built = buildCharacter(build, sources);
    expect(built.warnings).toEqual([]);
    // +2 Constitution (Dwarf) and +1 Wisdom (Hill Dwarf); the 4th level ASI's +2 Strength (the suggestion).
    expect(built.fields.abilities).toMatchObject({ con: 16, wis: 13, str: 17 });
    // Hit points: 10 + 4 × 6, +3 Constitution a level, +1 a level (Dwarven Toughness).
    expect(built.fields.maxHp).toBe(10 + 4 * 6 + 5 * 3 + 5);
    expect(built.fields.speed).toBe(25);
    const names = built.features.map((entry) => entry.feature.name);
    expect(names).toEqual(expect.arrayContaining(["Second Wind", "Action Surge", "Extra Attack", "Improved Critical", "Dwarven Resilience", "Dwarven Toughness", "Shelter of the Faithful", "Defense"]));
    expect(names).not.toContain("Weapon Mastery");
    expect(names).not.toContain("Tactical Mind");
    const secondWind = built.features.find((entry) => entry.feature.name === "Second Wind")!.feature;
    expect((secondWind.grantedActions![0] as Extract<ActionDefinition, { kind: "healing" }>).healing[0]!.dice).toBe("1d10+5");
    expect(built.resources).toMatchObject({ "second-wind": 1, "action-surge": 1 });
    expect(built.masteries).toEqual([]);
    expect(built.equipment.map((entry) => entry.ref).sort()).toEqual(["srd:item:chain-mail", "srd:item:shield", "srd:weapon:light-crossbow", "srd:weapon:longsword"]);
    // The features' ids keep the class's plain name.
    expect(built.features.find((entry) => entry.feature.name === "Second Wind")!.feature.id).toBe("fighter-second-wind");
  });

  it("a 2014 Champion's later features: Remarkable Athlete on initiative, Superior Critical, Survivor", () => {
    const built = buildCharacter(quickBuild(sources, { classId: "srd:class:fighter-2014", level: 18 }), sources);
    const feature = (name: string) => built.features.find((entry) => entry.feature.name === name)?.feature;
    // Proficiency bonus +6: half, rounded up, is 3.
    expect(feature("Remarkable Athlete")!.effects).toEqual([{ kind: "initiative", bonus: { base: 3 } }]);
    expect(feature("Superior Critical")!.effects![0]).toMatchObject({ kind: "critical-range", minimum: 18 });
    expect(feature("Improved Critical")).toBeUndefined();
    expect(feature("Survivor")!.effects![0]).toMatchObject({ kind: "hp-regen", whileBloodied: true });
    expect(feature("Extra Attack (three attacks)")).toBeDefined();
  });

  it("a 2014 Rogue: Sneak Attack by its table, Stroke of Luck a hit, and none of the 2024 rogue's", () => {
    const built = buildCharacter(quickBuild(sources, { classId: "srd:class:rogue-2014", level: 20 }), sources);
    const names = built.features.map((entry) => entry.feature.name);
    expect(names).not.toEqual(expect.arrayContaining(["Cunning Strike"]));
    expect(names).not.toContain("Steady Aim");
    const sneak = built.features.find((entry) => entry.feature.name === "Sneak Attack")!.feature;
    expect((sneak.effects![0] as { damage: Array<{ dice: string }> }).damage[0]!.dice).toBe("10d6");
    expect(built.features.find((entry) => entry.feature.name === "Stroke of Luck")!.feature.effects).toEqual([
      { kind: "d20-change", rolls: ["attack"], change: "hit", resourceCost: { resourceId: "stroke-of-luck", amount: 1 } }
    ]);
    // Slippery Mind: Wisdom saves only (2024 adds Charisma).
    expect(Object.keys(built.fields.saves).sort()).toEqual(["dex", "int", "wis"]);
  });

  it("a 2014 Human takes +1 to every score; the Grappler wants Strength 13", () => {
    const built = buildCharacter(quickBuild(sources, { classId: "srd:class:rogue-2014", backgroundId: "srd:background:acolyte-2014", speciesId: "srd:species:human-2014", abilities: { method: "manual", base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } } }), sources);
    expect(built.fields.abilities).toEqual({ str: 11, dex: 11, con: 11, int: 11, wis: 11, cha: 11 });
    const grappler = SRD_2014_CATALOG.feats.find((feat) => feat.id === "srd:feat:grappler-2014")!;
    expect(grappler.prerequisite).toMatchObject({ abilities: { str: 13 } });
  });

  it("a 2014 Fighter's fighting styles are 2014's, and its Protection is a reaction", () => {
    const styles = SRD_2014_CATALOG.feats.filter((feat) => feat.category === "fighting-style").map((feat) => feat.name);
    expect(styles).toEqual(["Archery", "Defense", "Dueling", "Great Weapon Fighting", "Protection", "Two-Weapon Fighting"]);
    let build = quickBuild(sources, { classId: "srd:class:fighter-2014" });
    build = withChoice(build, { kind: "level", index: 0 }, ["fighting-style"], { feat: "srd:feat:protection-2014" });
    const actor = rebuildActor(blankCharacter("pc", "Guard"), build, sources).definition;
    const protection = getExecutableActions(actor).find((action) => action.name === "Protection")!;
    expect(protection).toMatchObject({ actionType: "reaction", reaction: { trigger: { kind: "ally-targeted-by-attack", withinFt: 5 } } });
  });
});

describe("the 2014 Barbarian and Monk (Phase 8)", () => {
  const built = (classId: string, level: number) => buildCharacter(quickBuild(sources, { classId, level }), sources);
  const feature = (entry: ReturnType<typeof built>, name: string) => entry.features.find((candidate) => candidate.feature.name === name)?.feature;
  const actorOf = (classId: string, level: number) => rebuildActor(blankCharacter("def-fighter", "Hero"), withSuggestions(quickBuild(sources, { classId, level }), sources), sources).definition;

  it("a 2014 Barbarian rages for melee attacks only, as often as its table says, and has none of the 2024 barbarian's", () => {
    const first = built("srd:class:barbarian-2014", 1);
    expect(first.resources).toMatchObject({ rage: 2 });
    const rage = feature(first, "Rage")!.grantedActions![0] as Extract<ActionDefinition, { kind: "activate-feature" }>;
    expect(rage.condition!.effects![0]).toMatchObject({ kind: "damage-bonus", abilities: ["str"], attackTypes: ["melee"], damage: [{ dice: "2" }] });
    expect(rage.condition).toMatchObject({ upkeep: { by: ["attack", "damaged"] }, endsOnUnconscious: true });
    expect(first.equipment.map((entry) => `${entry.ref}×${entry.count ?? 1}`).sort()).toEqual(["srd:weapon:greataxe×1", "srd:weapon:handaxe×2", "srd:weapon:javelin×4"]);

    const top = built("srd:class:barbarian-2014", 20);
    expect(top.resources).toMatchObject({ rage: 99 });
    const names = top.features.map((entry) => entry.feature.name);
    for (const name of ["Weapon Mastery", "Primal Knowledge", "Instinctive Pounce", "Brutal Strike"]) expect(names).not.toContain(name);
    expect(feature(top, "Reckless Attack")!.grantedActions![0]).toMatchObject({ condition: { effects: [{ kind: "attack-advantage", abilities: ["str"], attackTypes: ["melee"] }] } });
    expect(feature(top, "Brutal Critical")!.effects).toEqual([{ kind: "damage-dice", criticalDice: 3, attackTypes: ["melee"] }]);
    // Relentless Rage leaves it at 1 hit point; Primal Champion's cap is 24.
    expect((feature(top, "Relentless Rage")!.effects![0] as { hpTo?: number }).hpTo).toBeUndefined();
    expect(top.fields.abilities.str).toBeLessThanOrEqual(24);
  });

  it("a 2014 Berserker frightens one creature with an action, and its Frenzy is on the sheet for the DM", () => {
    const berserker = built("srd:class:barbarian-2014", 14);
    expect(feature(berserker, "Frenzy")!.automationSupport).toBe("manual-only");
    expect(feature(berserker, "Intimidating Presence")!.grantedActions![0]).toMatchObject({
      kind: "save", actionType: "action", range: 30, saveAbility: "wis", dcFormula: { ability: "cha", proficiency: true },
      riders: [{ condition: "frightened", duration: { kind: "until-source-turn", timing: "end" } }]
    });
    expect(feature(berserker, "Retaliation")).toBeDefined();
  });

  it("a 2014 Monk spends ki: a Flurry, a Dodge, a Dash or a Disengage, and any number of Stunning Strikes", () => {
    const monk = built("srd:class:monk-2014", 5);
    expect(monk.resources).toMatchObject({ ki: 5 });
    const ki = feature(monk, "Ki")!.grantedActions!;
    expect(ki.map((action) => [action.name, "resourceCost" in action ? action.resourceCost?.resourceId : undefined])).toEqual([
      ["Flurry of Blows", "ki"], ["Patient Defense", "ki"], ["Step of the Wind: Dash", "ki"], ["Step of the Wind: Disengage", "ki"]
    ]);
    expect(ki[1]).toMatchObject({ mode: "dodge" });
    const unarmed = monk.weapons.find((entry) => entry.weapon.name === "Unarmed Strike")!.weapon;
    expect(unarmed.damage[0]!.dice).toBe("1d6");
    const stun = unarmed.onHit!.find((rider) => rider.kind === "condition" && rider.condition === "stunned")!;
    expect(stun).toMatchObject({ duration: { kind: "until-source-turn", timing: "end" }, save: { ability: "con", onSuccess: "negates" }, resourceCost: { resourceId: "ki" } });
    expect((stun as { oncePerTurn?: boolean }).oncePerTurn).toBeUndefined();
    expect((stun as { save: { instead?: unknown } }).save.instead).toBeUndefined();
    expect(unarmed.magical).toBeUndefined();
    // Ki-Empowered Strikes: magical from 6th level, still bludgeoning.
    const sixth = built("srd:class:monk-2014", 6).weapons.find((entry) => entry.weapon.name === "Unarmed Strike")!.weapon;
    expect(sixth).toMatchObject({ magical: true, damage: [{ damageType: "bludgeoning" }] });
    // The sheet says what gave a feature by its plain name.
    const actor = actorOf("srd:class:monk-2014", 3);
    expect(builtFrom(actor, actor.features!.find((entry) => entry.name === "Open Hand Technique")!.id)).toBe("Way Of The Open Hand");
  });

  it("a 2014 Monk's monk weapons are shortswords and simple melee weapons that aren't two-handed or heavy", () => {
    // 11th level: a d8 Martial Arts die, more than a spear's or a scimitar's d6.
    const monk = actorOf("srd:class:monk-2014", 11);
    const weapon = (id: string) => SRD_BUILDER_LIBRARY.weapon(id)!;
    const armed = { ...monk, weapons: [...(monk.weapons ?? []), weapon("srd:weapon:greatclub"), weapon("srd:weapon:spear"), weapon("srd:weapon:scimitar")], items: [] };
    const attack = (name: string) => getExecutableActions(armed).find((action) => action.name === name) as Extract<ActionDefinition, { kind: "attack" }>;
    // A spear: Dexterity (the better) and the Martial Arts die.
    expect(attack("Spear")).toMatchObject({ ability: "dex", damage: [{ dice: "1d8" }] });
    // A greatclub is two-handed: Strength and its own die.
    expect(attack("Greatclub")).toMatchObject({ ability: "str", damage: [{ dice: "1d8" }] });
    // A scimitar is a 2024 Monk weapon (martial, light), not a 2014 one: its own d6.
    expect(attack("Scimitar").damage[0]!.dice).toBe("1d6");
  });

  it("a 2014 Monk's Deflect Missiles takes a ranged weapon attack's damage down, never a melee one's", () => {
    const monk = actorOf("srd:class:monk-2014", 3);
    const snapshot = structuredClone(sampleEncounter);
    snapshot.map.walls = [];
    snapshot.map.terrain = [];
    snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), monk];
    const token = snapshot.combatants.find((entry) => entry.id === "pc-fighter")!;
    token.currentHp = 200; token.resources = { ...(monk.resources ?? {}) }; token.position = { x: 3, y: 3 };
    const goblin = snapshot.combatants.find((entry) => entry.id === "enemy-goblin-1")!;
    snapshot.turnIndex = snapshot.combatants.indexOf(goblin);
    const goblinActions = getExecutableActions(snapshot.definitions.find((entry) => entry.id === goblin.definitionId)!);
    const melee = goblinActions.find((action) => action.kind === "attack" && action.attackType === "melee")!;
    const ranged = goblinActions.find((action) => action.kind === "attack" && action.attackType === "ranged")!;
    const cutBy = (action: ActionDefinition, position: { x: number; y: number }) => {
      const state = createEngineState(structuredClone(snapshot));
      state.snapshot.combatants.find((entry) => entry.id === "enemy-goblin-1")!.position = position;
      const rng: RandomSource = { next: () => 0.5, nextInt: (_min, max) => max, fork: () => rng };
      state.rng = rng;
      resolveAttack(state, "enemy-goblin-1", "pc-fighter", action.id);
      return state.log.find((entry) => entry.type === "DamageApplied" && entry.data?.targetId === "pc-fighter")?.data?.cutBy;
    };
    expect(cutBy(melee, { x: 4, y: 3 })).toBeUndefined();
    expect(cutBy(ranged, { x: 7, y: 3 })).toBe("Deflect Missiles");
  });

  it("2014 Barbarians and Monks fight to the end with no illegal actions", { timeout: 60000 }, () => {
    const problems: string[] = [];
    for (const classId of ["srd:class:barbarian-2014", "srd:class:monk-2014"]) {
      for (const level of [3, 11, 20]) {
        const actor = actorOf(classId, level);
        const snapshot = structuredClone(sampleEncounter);
        snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), actor];
        for (const token of snapshot.combatants) {
          if (token.id === "pc-fighter") { token.currentHp = actor.maxHp; token.resources = { ...(actor.resources ?? {}) }; }
        }
        problems.push(...runAutomatedEncounter({ ...snapshot, seed: `${classId}-${level}-fight` }, 8).outcome.warnings.map((warning) => `${classId} ${level}: ${warning}`));
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("the 2014 Wizard, Sorcerer and Cleric (Phase 9a)", () => {
  const BASE = { str: 8, dex: 14, con: 14, int: 16, wis: 16, cha: 16 };
  const build = (classId: string, level: number) => withSuggestions(quickBuild(sources, { classId, level, abilities: { method: "manual", base: BASE } }), sources);
  const built = (classId: string, level: number) => buildCharacter(build(classId, level), sources);
  const feature = (entry: ReturnType<typeof built>, name: string) => entry.features.find((candidate) => candidate.feature.name === name)?.feature;
  const slot = (entry: ReturnType<typeof built>, kind: string, id?: string) => entry.choices.find((candidate) => candidate.spec.kind === kind && (!id || candidate.spec.id === id));
  const actorOf = (classId: string, level: number) => rebuildActor(blankCharacter("def-fighter", "Caster"), build(classId, level), sources).definition;
  const mod = (score: number) => Math.floor((score - 10) / 2);
  const prepared = (entry: ReturnType<typeof built>) => entry.choices.filter((candidate) => candidate.spec.kind === "spells" && candidate.spec.what === "prepared").reduce((sum, candidate) => sum + candidate.count, 0);

  it("a 2014 Wizard: its tradition at 2nd level, its modifier plus its level prepared from a book of 6 + 2 a level, 2014 spells", () => {
    const first = built("srd:class:wizard-2014", 1);
    expect(first.warnings).toEqual([]);
    expect(slot(first, "subclass")).toBeUndefined();
    expect(slot(built("srd:class:wizard-2014", 2), "subclass")).toBeDefined();
    const fifth = built("srd:class:wizard-2014", 5);
    // Its Intelligence modifier (after the background's points and the 4th-level ASI) plus 5.
    expect(prepared(fifth)).toBe(mod(fifth.fields.abilities.int) + 5);
    expect(fifth.choices.filter((entry) => entry.spec.kind === "spells" && entry.spec.what === "spellbook").reduce((sum, entry) => sum + entry.count, 0)).toBe(6 + 2 * 4);
    const cantrips = fifth.choices.filter((entry) => entry.spec.kind === "spells" && entry.spec.what === "cantrips");
    expect(cantrips.reduce((sum, entry) => sum + entry.count, 0)).toBe(4);
    expect(cantrips.every((entry) => entry.options.every((option) => option.edition === "2014"))).toBe(true);
    expect(feature(fifth, "Sculpt Spells")).toBeDefined();
    expect(feature(fifth, "Potent Cantrip")).toBeUndefined();
  });

  it("a 2014 Evoker's Potent Cantrip halves a cantrip's damage on a made save, never on a miss", () => {
    const wizard = actorOf("srd:class:wizard-2014", 6);
    expect(wizard.features!.find((entry) => entry.name === "Potent Cantrip")!.effects).toEqual([{ kind: "spell-half-on-miss", cantripsOnly: true, savesOnly: true }]);
    const armed = { ...wizard, spells: [...(wizard.spells ?? []).filter((spell) => spell.level > 0), SRD_BUILDER_LIBRARY.spell!("srd:spell:fire-bolt")!, SRD_BUILDER_LIBRARY.spell!("srd:spell:acid-splash")!] };
    const fireBolt = getExecutableActions(armed).find((action) => action.name === "Fire Bolt") as Extract<ActionDefinition, { kind: "attack" }>;
    expect(fireBolt.halfDamageOnMiss).toBeUndefined();
    const acidSplash = getExecutableActions(armed).find((action) => action.name === "Acid Splash") as Extract<ActionDefinition, { kind: "save" | "area-save" }>;
    expect(acidSplash.onSuccess).toBe("half");
  });

  it("a 2014 Sorcerer knows its table's spells, makes slots and points with bonus actions, and has the eight 2014 Metamagic options", () => {
    const first = built("srd:class:sorcerer-2014", 1);
    expect(slot(first, "subclass")).toBeDefined();
    expect(slot(first, "spells", "cantrips")!.count).toBe(4);
    expect(prepared(first)).toBe(2);
    const third = built("srd:class:sorcerer-2014", 3);
    const font = feature(third, "Font of Magic")!.grantedActions!;
    expect(font.map((action) => action.actionType)).toEqual(["bonus", "bonus", "bonus", "bonus", "bonus", "bonus"]);
    const options = slot(third, "pick", "metamagic-options")!;
    expect(options.count).toBe(2);
    expect(options.options.map((option) => option.name)).toEqual(["Careful Spell", "Distant Spell", "Empowered Spell", "Extended Spell", "Heightened Spell", "Quickened Spell", "Subtle Spell", "Twinned Spell"]);
    const twentieth = buildCharacter(withChoice(build("srd:class:sorcerer-2014", 3), { kind: "level", index: 2 }, ["metamagic-options"], ["heightened-spell", "careful-spell"]), sources);
    expect(feature(twentieth, "Metamagic: Heightened Spell")!.effects).toEqual([{ kind: "metamagic", option: "heightened", resourceCost: { resourceId: "sorcery-points", amount: 3 } }]);
    expect(feature(twentieth, "Metamagic: Careful Spell")!.automationSupport).toBe("partial");
  });

  it("a 2014 Draconic sorcerer: 13 + Dexterity, a hit point a level, its ancestor's affinity at 6th level, wings at 14th", () => {
    let draconic = build("srd:class:sorcerer-2014", 14);
    draconic = withChoice(draconic, { kind: "level", index: 0 }, ["subclass"], "srd:subclass:draconic-bloodline-2014");
    draconic = withChoice(draconic, { kind: "level", index: 0 }, ["dragon-ancestor"], ["red"]);
    const entry = buildCharacter(draconic, sources);
    expect(entry.warnings).toEqual([]);
    expect(feature(entry, "Draconic Resilience")!.effects).toEqual([{ kind: "unarmored-ac", base: 13, abilities: ["dex"] }]);
    const affinity = feature(entry, "Elemental Affinity (fire)")!;
    expect(affinity.effects).toEqual([{ kind: "spell-damage-ability", ability: "cha", spellsOnly: true, damageTypes: ["fire"] }]);
    expect(feature(entry, "Dragon Wings")!.grantedActions![0]).toMatchObject({ actionType: "bonus", condition: { modifiers: { flySpeed: "walk" } } });
    // Hit points: 6 + 13 × 4, and Constitution and Draconic Resilience's 1 a level.
    expect(entry.fields.maxHp).toBe(6 + 13 * 4 + 14 * mod(entry.fields.abilities.con) + 14);
  });

  it("a 2014 Cleric: its domain at 1st level, Channel Divinity once, twice, three times, Divine Strike growing at 14th", () => {
    const first = built("srd:class:cleric-2014", 1);
    expect(first.warnings).toEqual([]);
    // Its Wisdom modifier plus 1.
    expect(prepared(first)).toBe(mod(first.fields.abilities.wis) + 1);
    expect(first.spells.map((entry) => entry.spell.name)).toEqual(expect.arrayContaining(["Bless", "Cure Wounds"]));
    expect(feature(first, "Disciple of Life")).toBeDefined();
    for (const [level, uses] of [[2, 1], [6, 2], [18, 3]] as const) expect(built("srd:class:cleric-2014", level).resources["channel-divinity"], `level ${level}`).toBe(uses);
    const eighth = built("srd:class:cleric-2014", 8);
    expect((feature(eighth, "Divine Strike")!.effects![0] as { damage: Array<{ dice: string }> }).damage[0]!.dice).toBe("1d8");
    expect((feature(built("srd:class:cleric-2014", 14), "Divine Strike")!.effects![0] as { damage: Array<{ dice: string }> }).damage[0]!.dice).toBe("2d8");
    expect(feature(eighth, "Destroy Undead")!.automationSupport).toBe("manual-only");
    expect(feature(eighth, "Turn Undead")).toBeUndefined();
    expect(feature(eighth, "Channel Divinity")!.grantedActions!.map((action) => action.name)).toEqual(["Turn Undead"]);
    expect(feature(eighth, "Channel Divinity: Preserve Life")!.grantedActions![0]).toMatchObject({ divided: { total: 40 } });
  });
});

describe("the 2014 Bard and Druid (Phase 9b)", () => {
  const built = (classId: string, level: number) => buildCharacter(withSuggestions(quickBuild(sources, { classId, level }), sources), sources);
  const feature = (entry: ReturnType<typeof built>, name: string) => entry.features.find((candidate) => candidate.feature.name === name)?.feature;
  const known = (entry: ReturnType<typeof built>) => entry.choices.filter((candidate) => candidate.spec.kind === "spells" && candidate.spec.what === "prepared" && !(candidate.spec as { alwaysPrepared?: boolean }).alwaysPrepared)
    .reduce((sum, candidate) => sum + candidate.count, 0);

  it("a 2014 Bard knows its table's spells, two of them Magical Secrets from any class at 10th level", () => {
    expect(known(built("srd:class:bard-2014", 1))).toBe(4);
    const tenth = built("srd:class:bard-2014", 10);
    expect(tenth.warnings).toEqual([]);
    // 14 known at 10th level: 12 of its own, two secrets.
    expect(known(tenth)).toBe(12);
    const secrets = tenth.choices.find((candidate) => candidate.spec.kind === "spells" && candidate.spec.id === "magical-secrets-10")!;
    expect(secrets.count).toBe(2);
    expect(secrets.options.some((option) => option.id === "srd:spell:fireball")).toBe(true);
    expect(secrets.options.every((option) => option.edition === "2014")).toBe(true);
  });

  it("a 2014 Bard's inspiration: a bonus action, a die growing at 5th, 10th and 15th level, Cutting Words with it", () => {
    const die = (level: number) => ((feature(built("srd:class:bard-2014", level), "Bardic Inspiration")!.grantedActions![0] as Extract<ActionDefinition, { kind: "buff" }>)
      .appliedCondition.effects![0] as { dice: string }).dice;
    expect([1, 5, 10, 15].map(die)).toEqual(["1d6", "1d8", "1d10", "1d12"]);
    const lore = built("srd:class:bard-2014", 6);
    expect((feature(lore, "Cutting Words")!.effects![0] as { dice: string }).dice).toBe("1d8");
    expect(feature(lore, "Countercharm")!.automationSupport).toBe("manual-only");
    expect(lore.choices.some((candidate) => candidate.spec.kind === "spells" && candidate.spec.id === "additional-magical-secrets")).toBe(true);
  });

  it("a 2014 Druid: its circle at 2nd level, a land's spells from 3rd, always prepared", () => {
    let build = withSuggestions(quickBuild(sources, { classId: "srd:class:druid-2014", level: 3 }), sources);
    build = withChoice(build, { kind: "level", index: 1 }, ["land"], ["arctic"]);
    const third = buildCharacter(build, sources);
    expect(third.warnings).toEqual([]);
    expect(third.choices.find((candidate) => candidate.spec.kind === "pick" && candidate.spec.id === "land")!.options).toHaveLength(7);
    expect(third.spells.map((entry) => entry.spell.name)).toEqual(expect.arrayContaining(["Hold Person", "Spike Growth"]));
    expect(third.spells.map((entry) => entry.spell.name)).not.toContain("Sleet Storm");
    expect(third.choices.some((candidate) => candidate.spec.kind === "spells" && candidate.spec.id === "bonus-cantrip")).toBe(true);
    const tenth = built("srd:class:druid-2014", 10);
    expect(feature(tenth, "Land's Stride")!.effects).toEqual([{ kind: "ignore-difficult-terrain" }]);
    expect(tenth.fields.conditionImmunities).toContain("poisoned");
  });
});

describe("the 2014 Warlock, Paladin and Ranger (Phase 9c)", () => {
  const build = (classId: string, level: number) => withSuggestions(quickBuild(sources, { classId, level }), sources);
  const built = (classId: string, level: number) => buildCharacter(build(classId, level), sources);
  const feature = (entry: ReturnType<typeof built>, name: string) => entry.features.find((candidate) => candidate.feature.name === name)?.feature;
  const pickAt = (entry: ReturnType<typeof built>, index: number, id: string) => entry.choices.find((candidate) => candidate.scope.kind === "level" && candidate.scope.index === index && candidate.spec.kind === "pick" && candidate.spec.id === id);
  const actorOf = (built: ReturnType<typeof build>) => rebuildActor(blankCharacter("def-fighter", "Hero"), built, sources).definition;

  it("a 2014 Warlock: its patron at 1st level, two invocations at 2nd, its Pact Boon at 3rd that an invocation can need", () => {
    const first = built("srd:class:warlock-2014", 1);
    expect(first.choices.some((candidate) => candidate.spec.kind === "subclass")).toBe(true);
    expect(built("srd:class:warlock-2014", 2).choices.find((candidate) => candidate.spec.kind === "pick" && candidate.spec.id === "eldritch-invocations")!.count).toBe(2);
    const third = built("srd:class:warlock-2014", 3);
    expect(pickAt(third, 2, "eldritch-invocations")!.options.map((option) => option.name)).toEqual(["Pact of the Chain", "Pact of the Blade", "Pact of the Tome"]);
    // Thirsting Blade (5th level) needs Pact of the Blade: the suggested Tome leaves it out of reach.
    const tome = buildCharacter(build("srd:class:warlock-2014", 5), sources);
    expect(pickAt(tome, 4, "eldritch-invocations")!.options.find((option) => option.id === "thirsting-blade")).toMatchObject({ taken: true, detail: "needs Pact of the Blade" });
    let blade = withChoice(build("srd:class:warlock-2014", 5), { kind: "level", index: 2 }, ["eldritch-invocations"], ["pact-of-the-blade"]);
    blade = withChoice(blade, { kind: "level", index: 4 }, ["eldritch-invocations"], ["thirsting-blade"]);
    const bladeBuilt = buildCharacter(blade, sources);
    expect(bladeBuilt.warnings).toEqual([]);
    expect(bladeBuilt.weapons.find((entry) => entry.weapon.name === "Pact Weapon (Longsword)")!.weapon).toMatchObject({ ability: "str", magical: true, proficient: true });
    expect(feature(bladeBuilt, "Eldritch Invocation: Thirsting Blade")!.grantedActions![0]).toMatchObject({ kind: "multiattack", attacks: [{ actionId: "warlock-pact-weapon", count: 2 }] });
    // 32 invocations, Armor of Shadows among them (its heading restored).
    expect(pickAt(built("srd:class:warlock-2014", 2), 1, "eldritch-invocations")!.options).toHaveLength(32);
  });

  it("a 2014 Fiend chooses from its expanded list, gains temporary hit points on a kill, and knows its spells from the table", () => {
    const fifth = built("srd:class:warlock-2014", 5);
    const known = fifth.choices.filter((candidate) => candidate.spec.kind === "spells" && candidate.spec.what === "prepared");
    expect(known.reduce((sum, candidate) => sum + candidate.count, 0)).toBe(6);
    // Fireball isn't on the 2014 warlock list, but the Fiend adds it.
    expect(known.some((candidate) => candidate.options.some((option) => option.id === "srd:spell:fireball"))).toBe(true);
    expect(feature(fifth, "Dark One's Blessing")!.effects![0]).toMatchObject({ kind: "on-kill", tempHp: { ability: "cha", base: 5 } });
    expect(fifth.choices.find((candidate) => candidate.spec.kind === "pick" && candidate.spec.id === "eldritch-invocations" && candidate.scope.kind === "level" && candidate.scope.index === 1)!.value).toEqual(["agonizing-blast", "repelling-blast"]);
    const blast = getExecutableActions(actorOf(build("srd:class:warlock-2014", 5))).find((action) => action.name === "Eldritch Blast") as Extract<ActionDefinition, { kind: "attack" }>;
    expect(blast.damage[0]).toMatchObject({ abilityModifier: "cha" });
  });

  it("a 2014 Paladin: no slots before 2nd level, four fighting styles, and Divine Smite's 5d8 at most", () => {
    expect(built("srd:class:paladin-2014", 1).resources["slot-1"]).toBeUndefined();
    const second = built("srd:class:paladin-2014", 2);
    const styles = second.choices.find((candidate) => candidate.spec.kind === "feat" && candidate.spec.id === "fighting-style")!;
    expect([...new Set(styles.options.map((option) => option.name))].sort()).toEqual(["Defense", "Dueling", "Great Weapon Fighting", "Protection"]);
    const paladin = actorOf(build("srd:class:paladin-2014", 17));
    const smites = getExecutableActions(paladin).filter((action) => /Divine Smite/.test(action.name) && action.kind === "attack") as Array<Extract<ActionDefinition, { kind: "attack" }>>;
    const dice = (action: Extract<ActionDefinition, { kind: "attack" }>) => {
      const rider = action.riders!.find((entry) => entry.kind === "damage" && !entry.restrictToCreatureTypes) as { components: Array<{ dice: string }> };
      return [...rider.components[0]!.dice.matchAll(/(\d+)d8/g)].reduce((sum, match) => sum + Number(match[1]), 0);
    };
    const byLevel = (level: number) => smites.find((action) => (level === 1 ? !/level \d/.test(action.name) : action.name.includes(`level ${level}`)))!;
    expect([1, 2, 3, 4, 5].map((level) => dice(byLevel(level)))).toEqual([2, 3, 4, 5, 5]);
    // 1d8 more on a fiend or undead.
    expect(byLevel(1).riders!.find((entry) => entry.kind === "damage" && entry.restrictToCreatureTypes)).toMatchObject({ restrictToCreatureTypes: ["fiend", "undead"] });
  });

  it("a 2014 Ranger: three favored enemies, Foe Slayer against them at 20th level, its spells from 2nd", () => {
    const top = built("srd:class:ranger-2014", 20);
    expect(top.warnings).toEqual([]);
    expect(top.choices.filter((candidate) => candidate.spec.kind === "pick" && candidate.spec.id === "favored-enemy")).toHaveLength(3);
    const slayers = top.features.filter((entry) => entry.feature.name.startsWith("Foe Slayer"));
    expect(slayers.map((entry) => entry.feature.name).sort()).toEqual(["Foe Slayer (humanoids)", "Foe Slayer (monstrosities)", "Foe Slayer (undead)"]);
    expect(slayers[0]!.feature.effects![0]).toMatchObject({ kind: "damage-bonus", oncePerTurn: true });
    expect(built("srd:class:ranger-2014", 19).features.some((entry) => entry.feature.name.startsWith("Foe Slayer"))).toBe(false);
    expect(built("srd:class:ranger-2014", 1).resources["slot-1"]).toBeUndefined();
    expect(built("srd:class:ranger-2014", 2).resources["slot-1"]).toBe(2);
  });
});

describe("the other 2014 races (Phase 7)", () => {
  const BASE = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  const raceBuild = (speciesId: string, level = 1, classId = "srd:class:fighter-2014") =>
    quickBuild(sources, { classId, level, backgroundId: "srd:background:acolyte-2014", speciesId, abilities: { method: "manual", base: BASE } });
  const actorOf = (build: ReturnType<typeof quickBuild>) => rebuildActor(blankCharacter("def-fighter", "Hero"), build, sources).definition;
  const fight = (actor: CreatureDefinition, seed: string) => {
    const snapshot = structuredClone(sampleEncounter);
    snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), actor];
    for (const token of snapshot.combatants) {
      if (token.id === "pc-fighter") { token.currentHp = actor.maxHp; token.resources = { ...(actor.resources ?? {}) }; }
    }
    return runAutomatedEncounter({ ...snapshot, seed }, 6).outcome.warnings;
  };

  it("every 2014 race and subrace builds at 1st and 5th level, its increases its own, and fights with legal actions", { timeout: 60000 }, () => {
    const problems: string[] = [];
    for (const species of SRD_2014_CATALOG.species) {
      for (const level of [1, 5]) {
        let build = withSuggestions(raceBuild(species.id, level), sources);
        const built = buildCharacter(build, sources);
        problems.push(...built.warnings.map((warning) => `${species.id} ${level}: ${warning}`));
        // Its own increases, and its subrace's: all from the race, none from the (2014) background.
        const raised = Object.entries(built.fields.abilities).filter(([ability, score]) => score > BASE[ability as keyof typeof BASE]);
        expect(raised.length, species.id).toBeGreaterThan(0);
        build = withSuggestions(build, sources);
        problems.push(...fight(actorOf(build), `${species.id}-${level}`).map((warning) => `${species.id} ${level}: ${warning}`));
      }
    }
    expect(problems).toEqual([]);
  });

  it("a Dragonborn breathes with an action of its own, by its ancestry's shape and save, 2d6 rising with its level", () => {
    expect(buildCharacter(raceBuild("srd:species:dragonborn-2014"), sources).fields.abilities).toMatchObject({ str: 12, cha: 11 });
    let build = raceBuild("srd:species:dragonborn-2014", 11);
    build = withChoice(build, { kind: "species" }, ["draconic-ancestry"], ["green"]);
    const built = buildCharacter(build, sources);
    const actor = actorOf(build);
    const breath = getExecutableActions(actor).find((action) => action.name === "Breath Weapon") as Extract<ActionDefinition, { kind: "area-save" }>;
    expect(breath).toMatchObject({ actionType: "action", saveAbility: "con", area: { type: "cone", size: 15 }, resourceCost: { resourceId: "breath-weapon", amount: 1 } });
    expect(breath.replacesAttack).toBeUndefined();
    expect(breath.damage[0]).toMatchObject({ dice: "2d6", damageType: "poison", scaling: { mode: "cantrip-by-level", steps: [{ atLevel: 6, dice: "3d6" }, { atLevel: 11, dice: "4d6" }, { atLevel: 16, dice: "5d6" }] } });
    expect(built.resources).toMatchObject({ "breath-weapon": 1 });
    expect(built.features.find((entry) => entry.feature.name === "Damage Resistance")!.feature.effects).toEqual([{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "poison" } }]);
  });

  it("a High Elf knows a 2014 Wizard cantrip, cast with Intelligence; an Elf has Perception", () => {
    let build = raceBuild("srd:species:elf-2014");
    build = withChoice(build, { kind: "species" }, ["subrace"], ["high-elf"]);
    const slot = buildCharacter(build, sources).choices.find((entry) => entry.scope.kind === "species" && entry.spec.kind === "spells")!;
    expect(slot.options.length).toBeGreaterThan(5);
    expect(slot.options.every((option) => option.edition === "2014" && option.level === 0)).toBe(true);
    build = withChoice(build, slot.scope, slot.path, ["srd:spell:fire-bolt"], slot.spec);
    const built = buildCharacter(build, sources);
    expect(built.warnings).toEqual([]);
    expect(built.fields.abilities).toMatchObject({ dex: 12, int: 11 });
    expect(Object.keys(built.fields.skills)).toContain("perception");
    const fireBolt = getExecutableActions(actorOf(build)).find((action) => action.name === "Fire Bolt") as Extract<ActionDefinition, { kind: "attack" }>;
    expect(fireBolt.ability).toBe("int");
  });

  it("a Gnome's cunning is against magic only; a Rock Gnome adds Constitution", () => {
    let build = raceBuild("srd:species:gnome-2014");
    build = withChoice(build, { kind: "species" }, ["subrace"], ["rock-gnome"]);
    const built = buildCharacter(build, sources);
    expect(built.fields.abilities).toMatchObject({ int: 12, con: 11 });
    expect(built.fields.speed).toBe(25);
    expect(built.features.find((entry) => entry.feature.name === "Gnome Cunning")!.feature.effects).toEqual([
      { kind: "save-advantage", abilities: ["int", "wis", "cha"], against: { source: "magical" } }
    ]);
  });

  it("a Half-Elf chooses two skills and two increases besides Charisma; a Half-Orc is menacing and relentless", () => {
    const halfElf = buildCharacter(raceBuild("srd:species:half-elf-2014"), sources);
    expect(halfElf.fields.abilities.cha).toBe(12);
    const increases = halfElf.choices.find((slot) => slot.scope.kind === "species" && slot.spec.kind === "abilities")!;
    expect(increases.spec).toMatchObject({ points: 2, maxPerAbility: 1, from: ["str", "dex", "con", "int", "wis"] });
    expect(halfElf.choices.find((slot) => slot.spec.kind === "skills" && slot.spec.id === "skill-versatility")!.spec).toMatchObject({ count: 2, from: "any" });

    const halfOrc = buildCharacter(raceBuild("srd:species:half-orc-2014"), sources);
    expect(halfOrc.fields.abilities).toMatchObject({ str: 12, con: 11 });
    expect(Object.keys(halfOrc.fields.skills)).toContain("intimidation");
    expect(halfOrc.resources).toMatchObject({ "relentless-endurance": 1 });
    expect(halfOrc.features.find((entry) => entry.feature.name === "Savage Attacks")!.feature.effects).toEqual([{ kind: "damage-dice", criticalDice: 1, attackTypes: ["melee"] }]);
  });

  it("a Lightfoot Halfling: small, slow, lucky", () => {
    let build = raceBuild("srd:species:halfling-2014");
    build = withChoice(build, { kind: "species" }, ["subrace"], ["lightfoot"]);
    const built = buildCharacter(build, sources);
    expect(built.fields).toMatchObject({ size: "small", speed: 25 });
    expect(built.fields.abilities).toMatchObject({ dex: 12, cha: 11 });
    expect(built.features.map((entry) => entry.feature.name)).toEqual(expect.arrayContaining(["Lucky", "Brave", "Halfling Nimbleness", "Naturally Stealthy"]));
  });

  it("a Tiefling casts Hellish Rebuke once a day as a 2nd-level spell, never with a slot, and Darkness from 5th", () => {
    const third = buildCharacter(raceBuild("srd:species:tiefling-2014", 3), sources);
    expect(third.spells.map((entry) => entry.spell.name).sort()).toEqual(["Hellish Rebuke (Infernal Legacy)", "Thaumaturgy"]);
    const actor = actorOf(raceBuild("srd:species:tiefling-2014", 5));
    expect(actor.spells!.map((entry) => entry.name).sort()).toEqual(["Darkness (Infernal Legacy)", "Hellish Rebuke (Infernal Legacy)", "Thaumaturgy"]);
    const rebuke = getExecutableActions(actor).find((action) => action.name === "Hellish Rebuke (Infernal Legacy)") as Extract<ActionDefinition, { kind: "save" }>;
    expect(rebuke.resourceCost?.resourceId).not.toMatch(/^slot-/);
    expect(castLevelOf(rebuke)).toBe(2);
    expect(spellcastingAbility(actor)).toBe("cha");

    // Cast: 2d10 and the 2nd level's 1d10.
    const snapshot = structuredClone(sampleEncounter);
    snapshot.map.walls = [];
    snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), actor];
    const caster = snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    caster.resources = { ...(actor.resources ?? {}) };
    snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!.position = { x: caster.position.x + 1, y: caster.position.y };
    const state = createEngineState(snapshot);
    const rng: RandomSource = { next: () => 0, nextInt: (min) => min, fork: () => rng };
    state.rng = rng;
    resolveSaveAction(state, "pc-fighter", "enemy-goblin-1", rebuke.id);
    const damage = state.log.find((entry) => entry.type === "DamageApplied");
    expect((damage?.data?.components as Array<{ roll: { rolls: unknown[] } }>)[0]?.roll.rolls).toHaveLength(3);
  });
});
