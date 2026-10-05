import { describe, expect, it } from "vitest";
import {
  creatureDefinitionSchema,
  getExecutableActions,
  normalizeCreatureDefinition,
  sampleEncounter,
  type CreatureDefinition,
  type FeatureDefinition
} from "@/engine";
import { runAutomatedEncounter } from "@/engine/turns";
import { SRD_2024_REFERENCE } from "@/data/srd/2024/reference";
import {
  applyBuild,
  blankCharacter,
  buildCharacter,
  evaluateTemplate,
  fingerprint,
  pointBuyCost,
  quickBuild,
  rebuildActor,
  spellSlots,
  standardArrayFor,
  startBuild,
  withChoice,
  withLevelDown,
  withLevelUp,
  withSuggestions,
  type CharacterBuild
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

const sources = SRD_BUILD_SOURCES;
const FIGHTER = "srd:class:fighter";
const ROGUE = "srd:class:rogue";

function quick(classId: string, level: number, extra: Parameters<typeof startBuild>[1] extends infer O ? Partial<O> : never = {}): CharacterBuild {
  return quickBuild(sources, { classId, level, ...extra });
}

function feature(definition: CreatureDefinition, id: string): FeatureDefinition {
  const found = [...(definition.features ?? []), ...(definition.traits ?? [])].find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no feature ${id} (has ${(definition.features ?? []).map((entry) => entry.id).join(", ")})`);
  return found;
}

const column = (classKey: string, id: string) =>
  SRD_2024_REFERENCE.classes.find((entry) => entry.key === `srd-2024_${classKey}`)!.columns.find((entry) => entry.id === id)!.values;

describe("templates", () => {
  const scope = {
    level: 5, charLevel: 7, pb: 3,
    abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 8, cha: 18 },
    columns: [{ id: "sneak-attack", label: "Sneak Attack", values: column("rogue", "sneak-attack") }]
  };

  it("reads levels, columns, modifiers and the proficiency bonus", () => {
    expect(evaluateTemplate("{level}", scope)).toBe(5);
    expect(evaluateTemplate("{charLevel}", scope)).toBe(7);
    expect(evaluateTemplate("{col:sneak-attack}", scope)).toBe("3d6");
    expect(evaluateTemplate("1d10+{level}", scope)).toBe("1d10+5");
    expect(evaluateTemplate("{mod:cha}", scope)).toBe(4);
    expect(evaluateTemplate("{pb}", scope)).toBe(3);
  });

  it("does whole-number arithmetic and floors", () => {
    expect(evaluateTemplate("{level*5}", scope)).toBe(25);
    expect(evaluateTemplate("{level/2}", scope)).toBe(2);
    expect(evaluateTemplate("{level+1}", scope)).toBe(6);
    expect(evaluateTemplate("{mod:wis|min:1}", scope)).toBe(1);
    expect(evaluateTemplate(4, scope)).toBe(4);
  });

  it("refuses what it can't read", () => {
    expect(() => evaluateTemplate("{col:nope}", scope)).toThrow(/no column/);
    expect(() => evaluateTemplate("{mod:luck}", scope)).toThrow(/no ability/);
    expect(() => evaluateTemplate("{col:sneak-attack*2}", scope)).toThrow(/arithmetic/);
  });
});

describe("spell slots", () => {
  const slotsAt = (classKey: string, level: number) => {
    const out: Record<string, number> = {};
    for (let slot = 1; slot <= 9; slot += 1) {
      const values = SRD_2024_REFERENCE.classes.find((entry) => entry.key === `srd-2024_${classKey}`)!.columns.find((entry) => entry.id === `slots-${slot}`)?.values;
      const count = values?.[level - 1];
      if (typeof count === "number" && count > 0) out[`slot-${slot}`] = count;
    }
    return out;
  };

  it("match every SRD 5.2 full caster's table at every level", () => {
    for (const classKey of ["bard", "cleric", "druid", "sorcerer", "wizard"]) {
      for (let level = 1; level <= 20; level += 1) {
        expect(spellSlots([{ kind: "full", classLevel: level }]), `${classKey} ${level}`).toEqual(slotsAt(classKey, level));
      }
    }
  });

  it("match the paladin's and ranger's tables (half casters, rounded up, from 1st level)", () => {
    for (const classKey of ["paladin", "ranger"]) {
      for (let level = 1; level <= 20; level += 1) {
        expect(spellSlots([{ kind: "half", classLevel: level }]), `${classKey} ${level}`).toEqual(slotsAt(classKey, level));
      }
    }
  });

  it("match the warlock's Pact Magic", () => {
    const counts = column("warlock", "spell-slots");
    const levels = column("warlock", "slot-level");
    for (let level = 1; level <= 20; level += 1) {
      expect(spellSlots([{ kind: "pact", classLevel: level }])).toEqual({ [`slot-${levels[level - 1]}`]: counts[level - 1] });
    }
  });

  it("give a lone third caster its own table, and round a third down when multiclassed", () => {
    expect(spellSlots([{ kind: "third", classLevel: 3 }])).toEqual({ "slot-1": 2 });
    expect(spellSlots([{ kind: "third", classLevel: 4 }])).toEqual({ "slot-1": 3 });
    expect(spellSlots([{ kind: "third", classLevel: 7 }])).toEqual({ "slot-1": 4, "slot-2": 2 });
    // Wizard 3 + paladin 4 (2) + an Eldritch Knight's 4 fighter levels (1) = caster level 6.
    expect(spellSlots([{ kind: "full", classLevel: 3 }, { kind: "half", classLevel: 4 }, { kind: "third", classLevel: 4 }]))
      .toEqual({ "slot-1": 4, "slot-2": 3, "slot-3": 3 });
    // Pact slots are their own.
    expect(spellSlots([{ kind: "full", classLevel: 1 }, { kind: "pact", classLevel: 1 }])).toEqual({ "slot-1": 3 });
  });
});

describe("ability scores", () => {
  it("deal the standard array by the class's priorities", () => {
    expect(standardArrayFor(["dex", "con", "wis"])).toEqual({ str: 12, dex: 15, con: 14, int: 10, wis: 13, cha: 8 });
  });

  it("cost point buy as the SRD says", () => {
    expect(pointBuyCost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 })).toBe(27);
    expect(pointBuyCost({ str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 })).toBeUndefined();
  });

  it("take the background's +2 and +1, and say what's wrong with a bad split", () => {
    const build = startBuild(sources, { classId: FIGHTER, backgroundId: "srd:background:soldier" });
    const good = buildCharacter({ ...build, background: { ...build.background, increases: { str: 2, con: 1 } } }, sources);
    expect(good.fields.abilities.str).toBe(build.abilities.base.str + 2);
    expect(good.fields.abilities.con).toBe(build.abilities.base.con + 1);
    const wrong = buildCharacter({ ...build, background: { ...build.background, increases: { wis: 2, str: 1 } } }, sources);
    const slot = wrong.choices.find((choice) => choice.path[0] === "increases")!;
    expect(slot.problem).toMatch(/wis/);
    expect(slot.pending).toBe(true);
    const three = buildCharacter({ ...build, background: { ...build.background, increases: { str: 1, dex: 1, con: 1 } } }, sources);
    expect(three.choices.find((choice) => choice.path[0] === "increases")!.pending).toBe(false);
  });

  it("raise past 20 only where a feat allows it, and spread increases once one is at the cap", () => {
    const fighter = buildCharacter(quick(FIGHTER, 20), sources);
    expect(fighter.fields.abilities.str).toBe(21); // 20 from Ability Score Improvements, +1 from an Epic Boon
    expect(fighter.fields.abilities.con).toBe(20);
  });
});

describe("a Fighter built from 1st to 20th level", () => {
  const at = (level: number) => rebuildActor(blankCharacter(`def-fighter-${level}`, "Fighter"), quick(FIGHTER, level), sources).definition;

  it("1st level: d10 + Con, Second Wind twice, Fighting Style and Weapon Mastery", () => {
    const fighter = at(1);
    expect(fighter.character?.level).toBe(1);
    expect(fighter.abilities).toEqual({ str: 17, dex: 13, con: 15, int: 8, wis: 12, cha: 10 });
    expect(fighter.maxHp).toBe(12);
    expect(fighter.proficiencyBonus).toBe(2);
    expect(fighter.saves).toEqual({ str: 5, con: 4 });
    expect(fighter.resources).toEqual({ "second-wind": 2 });
    const secondWind = feature(fighter, "fighter-second-wind");
    expect(secondWind.grantedActions?.[0]).toMatchObject({ kind: "healing", healing: [{ dice: "1d10+1" }], resourceCost: { resourceId: "second-wind", amount: 1 } });
    expect(feature(fighter, "feat-defense").effects).toEqual([{ kind: "armor-class-bonus", bonus: { base: 1 } }]);
    expect(feature(fighter, "fighter-weapon-mastery").description).toMatch(/Mastered: Greatsword \(Graze\), Flail \(Sap\), Spear \(Sap\)\./);
    expect(fighter.weapons?.map((weapon) => weapon.name)).toEqual(["Greatsword", "Flail", "Spear", "Shortbow"]);
    expect(fighter.items?.map((item) => item.name)).toEqual(["Chain Mail"]);
  });

  it("5th level: Extra Attack, Action Surge, Second Wind 1d10 + 5 three times, the Champion", () => {
    const fighter = at(5);
    expect(fighter.maxHp).toBe(10 + 4 * 6 + 5 * 2);
    expect(fighter.proficiencyBonus).toBe(3);
    expect(fighter.character?.classes).toEqual([{ id: FIGHTER, name: "Fighter", level: 5, subclass: { id: "srd:subclass:champion", name: "Champion" } }]);
    expect(fighter.resources).toEqual({ "second-wind": 3, "action-surge": 1 });
    expect(feature(fighter, "fighter-second-wind").grantedActions?.[0]).toMatchObject({ healing: [{ dice: "1d10+5" }] });
    expect(feature(fighter, "fighter-extra-attack").grantedActions?.[0]).toMatchObject({ kind: "multiattack", attacks: [{ any: "weapon", count: 2 }] });
    expect(feature(fighter, "champion-improved-critical").automationSupport).toBe("manual-only");
    const actions = getExecutableActions(fighter).map((action) => action.name);
    expect(actions).toEqual(expect.arrayContaining(["Attack", "Second Wind", "Action Surge", "Greatsword"]));
  });

  it("11th level: three attacks in place of two", () => {
    const fighter = at(11);
    expect(feature(fighter, "fighter-two-extra-attacks").grantedActions?.[0]).toMatchObject({ attacks: [{ any: "weapon", count: 3 }] });
    expect(fighter.features?.some((entry) => entry.id === "fighter-extra-attack")).toBe(false);
    expect(fighter.resources).toEqual({ "second-wind": 4, "action-surge": 1, indomitable: 1 });
  });

  it("20th level: four attacks, Action Surge twice, Indomitable three times, Superior Critical", () => {
    const fighter = at(20);
    expect(fighter.proficiencyBonus).toBe(6);
    expect(fighter.maxHp).toBe(10 + 19 * 6 + 20 * 5);
    expect(feature(fighter, "fighter-three-extra-attacks").grantedActions?.[0]).toMatchObject({ attacks: [{ any: "weapon", count: 4 }] });
    expect(fighter.resources).toEqual({ "second-wind": 4, "action-surge": 2, indomitable: 3 });
    expect(fighter.features?.some((entry) => entry.id === "champion-improved-critical")).toBe(false);
    expect(feature(fighter, "champion-superior-critical")).toBeTruthy();
    expect(fighter.features?.filter((entry) => entry.name.startsWith("Ability Score Improvement"))).toHaveLength(6);
    expect(feature(fighter, "feat-boon-of-combat-prowess")).toBeTruthy();
  });

  it("passes the creature schema at every level, with no warnings and no choice left open", () => {
    for (let level = 1; level <= 20; level += 1) {
      const build = quick(FIGHTER, level);
      const built = buildCharacter(build, sources);
      expect(built.warnings, `level ${level}`).toEqual([]);
      expect(built.choices.filter((choice) => choice.pending), `level ${level}`).toEqual([]);
      const { definition } = applyBuild(blankCharacter("def-f", "F"), build, built, { library: sources.library });
      expect(creatureDefinitionSchema.safeParse(definition).success, `level ${level}`).toBe(true);
    }
  });
});

describe("a Rogue", () => {
  it("deals the table's Sneak Attack at every level", () => {
    const dice = column("rogue", "sneak-attack");
    for (let level = 1; level <= 20; level += 1) {
      const rogue = rebuildActor(blankCharacter("def-r", "Rogue"), quick(ROGUE, level), sources).definition;
      expect(feature(rogue, "rogue-sneak-attack").effects?.[0], `level ${level}`).toMatchObject({ kind: "damage-bonus", damage: [{ dice: dice[level - 1] }] });
    }
  });

  it("gets expertise in proficient skills, its saves, and Slippery Mind's", () => {
    const rogue = rebuildActor(blankCharacter("def-r", "Rogue"), quick(ROGUE, 15), sources).definition;
    expect(Object.keys(rogue.saves ?? {}).sort()).toEqual(["cha", "dex", "int", "wis"]);
    const pb = 5;
    const dex = Math.floor((rogue.abilities.dex - 10) / 2);
    expect(rogue.skills?.stealth).toBe(dex + 2 * pb);
    expect(rogue.movement).toEqual({ walk: 30, climb: 30 });
  });

  it("leaves Steady Aim to the DM: it can't check it hasn't moved", () => {
    const rogue = rebuildActor(blankCharacter("def-r", "Rogue"), quick(ROGUE, 3), sources).definition;
    expect(getExecutableActions(rogue).find((action) => action.name === "Steady Aim")?.automationSupport).toBe("partial");
  });
});

describe("choices", () => {
  it("lists what a level asks for, with suggestions, and Quick build makes them all", () => {
    const build = startBuild(sources, { classId: FIGHTER, level: 4 });
    const pending = buildCharacter(build, sources).choices.filter((choice) => choice.pending);
    expect(pending.map((choice) => `${choice.owner}:${choice.path.join("/")}`)).toEqual([
      "Soldier:increases", "Fighter 1:class-skills", "Fighter 1:fighting-style", "Fighter 1:weapon-mastery",
      "Fighter 3:subclass", "Fighter 4:weapon-mastery", "Fighter 4:feat"
    ]);
    expect(pending.every((choice) => choice.suggestion !== undefined)).toBe(true);
    const filled = withSuggestions(build, sources);
    expect(buildCharacter(filled, sources).choices.filter((choice) => choice.pending)).toEqual([]);
  });

  it("keep what's chosen and only complete the rest", () => {
    let build = startBuild(sources, { classId: ROGUE, level: 1 });
    build = withChoice(build, { kind: "level", index: 0 }, ["class-skills"], ["deception"]);
    const filled = withSuggestions(build, sources);
    const skills = filled.levels[0]!.choices["class-skills"] as string[];
    expect(skills[0]).toBe("deception");
    expect(skills).toHaveLength(4);
  });

  it("refuse a feat taken twice that isn't repeatable, and an unknown subclass", () => {
    let build = quick(FIGHTER, 7);
    build = withChoice(build, { kind: "level", index: 6 }, ["fighting-style"], { feat: "srd:feat:defense" });
    const built = buildCharacter(build, sources);
    expect(built.choices.find((choice) => choice.characterLevel === 7 && choice.path[0] === "fighting-style")?.problem).toMatch(/already taken/);
    const unknown = buildCharacter(withChoice(quick(FIGHTER, 3), { kind: "level", index: 2 }, ["subclass"], "srd:subclass:nope"), sources);
    expect(unknown.choices.find((choice) => choice.path[0] === "subclass")?.problem).toMatch(/no subclass/);
    expect(unknown.features.some((entry) => entry.key.startsWith("subclass:"))).toBe(false);
  });
});

describe("applying a build to its actor", () => {
  const start = () => rebuildActor(blankCharacter("def-pc", "Vex"), quick(ROGUE, 4), sources);

  it("is the same actor for the same build", () => {
    expect(JSON.stringify(start().definition)).toBe(JSON.stringify(start().definition));
  });

  it("levels up: the new level's features come, numbers grow, and the diff says so", () => {
    const { definition, build } = start();
    const next = withSuggestions(withLevelUp(build), sources);
    const result = rebuildActor(definition, next, sources);
    expect(result.changes).toEqual(expect.arrayContaining([
      { kind: "gained", key: "feature:rogue-uncanny-dodge", name: "Uncanny Dodge" },
      { kind: "gained", key: "feature:rogue-cunning-strike", name: "Cunning Strike" },
      { kind: "changed", key: "feature:rogue-sneak-attack", name: "Sneak Attack", details: ["2d6 → 3d6"] },
      expect.objectContaining({ kind: "field", key: "field:proficiencyBonus", before: 2, after: 3 })
    ]));
    expect(result.changes.some((change) => change.kind === "kept")).toBe(false);
    expect(result.definition.character?.level).toBe(5);
  });

  it("keeps a feature the DM edited, and replaces it when asked", () => {
    const { definition, build } = start();
    const edited: CreatureDefinition = {
      ...definition,
      features: definition.features!.map((entry) => (entry.id === "rogue-cunning-action" ? { ...entry, name: "Cunning Action (house rule)" } : entry))
    };
    const next = withSuggestions(withLevelUp(build), sources);
    const kept = rebuildActor(edited, next, sources);
    expect(feature(kept.definition, "rogue-cunning-action").name).toBe("Cunning Action (house rule)");
    expect(kept.changes).toContainEqual(expect.objectContaining({ kind: "kept", key: "feature:rogue-cunning-action", name: "Cunning Action (house rule)", reason: "edited" }));
    // Still kept a level later: the build remembers it was edited.
    const later = rebuildActor(kept.definition, withSuggestions(withLevelUp(kept.build), sources), sources);
    expect(feature(later.definition, "rogue-cunning-action").name).toBe("Cunning Action (house rule)");
    const updated = rebuildActor(later.definition, later.build, sources, ["feature:rogue-cunning-action"]);
    expect(feature(updated.definition, "rogue-cunning-action").name).toBe("Cunning Action");
    // Once it's the builder's again, it's updated like any other.
    expect(rebuildActor(updated.definition, updated.build, sources).changes.some((change) => change.kind === "kept")).toBe(false);
  });

  it("leaves a feature the DM deleted deleted, and the DM's own features alone", () => {
    const { definition, build } = start();
    const mine: FeatureDefinition = { id: "my-trick", name: "Lucky Coin", category: "feature", automationSupport: "manual-only" };
    const changed: CreatureDefinition = {
      ...definition,
      features: [...definition.features!.filter((entry) => entry.id !== "rogue-thieves-cant"), mine]
    };
    const result = rebuildActor(changed, withSuggestions(withLevelUp(build), sources), sources);
    expect(result.definition.features?.some((entry) => entry.id === "rogue-thieves-cant")).toBe(false);
    expect(result.changes).toContainEqual({ kind: "kept", key: "feature:rogue-thieves-cant", name: "Thieves' Cant", reason: "removed" });
    expect(result.definition.features?.at(-1)).toEqual(mine);
  });

  it("keeps a typed field and the DM's own skill, and owns the rest", () => {
    const { definition, build } = start();
    const changed: CreatureDefinition = { ...definition, speed: 35, skills: { ...definition.skills, survival: 9 } };
    const result = rebuildActor(changed, withSuggestions(withLevelUp(build), sources), sources);
    expect(result.definition.speed).toBe(35);
    expect(result.definition.skills?.survival).toBe(9);
    expect(result.changes).toContainEqual(expect.objectContaining({ kind: "kept", key: "field:speed", reason: "edited" }));
  });

  it("levels down: exactly what the level gave goes, and the rest is as it was", () => {
    const four = start();
    const five = rebuildActor(four.definition, withSuggestions(withLevelUp(four.build), sources), sources);
    const back = rebuildActor(five.definition, withLevelDown(five.build), sources);
    expect(back.changes).toEqual(expect.arrayContaining([
      { kind: "lost", key: "feature:rogue-uncanny-dodge", name: "Uncanny Dodge" },
      { kind: "changed", key: "feature:rogue-sneak-attack", name: "Sneak Attack", details: ["3d6 → 2d6"] }
    ]));
    const strip = (definition: CreatureDefinition) => ({ ...definition, character: { ...definition.character, build: undefined } });
    expect(strip(back.definition)).toEqual(strip(four.definition));
  });

  it("puts the starting equipment on once", () => {
    const { definition, build } = start();
    expect(build.equipment?.applied).toBe(true);
    const again = rebuildActor(definition, build, sources).definition;
    expect(again.weapons).toHaveLength(definition.weapons!.length);
    expect(again.items).toHaveLength(definition.items!.length);
  });

  it("still knows its own records after an export and import", () => {
    const { definition } = start();
    const imported = normalizeCreatureDefinition(JSON.parse(JSON.stringify(definition)) as Record<string, unknown>);
    const build = imported.character?.build as CharacterBuild;
    const result = rebuildActor(imported, build, sources);
    expect(result.changes.filter((change) => change.kind === "kept")).toEqual([]);
  });

  it("fingerprints ignore key order, undefined fields and derived dice", () => {
    expect(fingerprint({ a: 1, b: { c: "1d6", diceCount: 1, diceSize: 6 } })).toBe(fingerprint({ b: { c: "1d6" }, a: 1, d: undefined, e: [] }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});

describe("a built party in a fight", () => {
  it("fights to the end with what the builder gave it", () => {
    const rogue = rebuildActor(blankCharacter("def-rogue", "Rogue"), quick(ROGUE, 5), sources).definition;
    const fighter = rebuildActor(blankCharacter("def-fighter-b", "Fighter"), quick(FIGHTER, 5), sources).definition;
    const snapshot = structuredClone(sampleEncounter);
    snapshot.definitions = [...snapshot.definitions, rogue, fighter];
    const template = snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    snapshot.combatants = [
      ...snapshot.combatants.filter((combatant) => combatant.faction !== "party"),
      { ...template, id: "pc-rogue", definitionId: rogue.id, displayName: "Rogue", currentHp: rogue.maxHp, resources: { ...(rogue.resources ?? {}) } },
      { ...template, id: "pc-fighter-b", definitionId: fighter.id, displayName: "Fighter", currentHp: fighter.maxHp, resources: { ...(fighter.resources ?? {}) }, position: { x: template.position.x, y: template.position.y + 1 } }
    ];
    const result = runAutomatedEncounter({ ...snapshot, seed: "pc-builder", round: 0, turnIndex: 0 }, 30);
    expect(result.outcome.completed).toBe(true);
    expect(result.outcome.winner).toBe("party");
  });
});
