import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  blankCharacter,
  catalogFile,
  entryProblems,
  mergeCatalog,
  parseCatalogEntry,
  quickBuild,
  readBuild,
  readCatalogFile,
  rebuildActor,
  withLevelUp,
  withSuggestions
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { creatureDefinitionSchema, getExecutableActions, sampleEncounter, type ActionDefinition, type CreatureDefinition } from "@/engine";
import { runAutomatedEncounter } from "@/engine/turns";
import { ARCANE_TRICKSTER, BAYOU_BLIGHT, DEADEYE, GUN, PARTY_HOMEBREW, SILENT_VEIL, SPIRITBOUND_MARKSMAN, TOTEM_WARRIOR, ZEALOT } from "./fixtures/homebrew/party";

/**
 * PC builder plan, Phase 8e: the party's homebrew (the Arcane Trickster, the Zealot, the Totem Warrior and the
 * Spiritbound Marksman with its paths), authored as catalog entries and leveled from 1 to 20.
 */

const sources = mergeCatalog(SRD_BUILD_SOURCES, PARTY_HOMEBREW);

/** Leveled from 1 to 20 as the Level up window does, the subclass chosen at its level; the actor at each level. */
function levelUp(classId: string, subclassId: string): { actors: CreatureDefinition[]; warnings: string[] } {
  const definition = sources.catalog.classes.find((entry) => entry.id === classId)!;
  let actor = rebuildActor(blankCharacter("def-fighter", "Hero"), quickBuild(sources, { classId, level: 1 }), sources).definition;
  const actors = [actor];
  const warnings: string[] = [];
  for (let level = 2; level <= 20; level += 1) {
    let build = withLevelUp(readBuild(actor)!);
    if (level === definition.subclassLevel) {
      build = { ...build, levels: build.levels.map((entry, index) => (index === level - 1 ? { ...entry, choices: { ...entry.choices, subclass: subclassId } } : entry)) };
    }
    const result = rebuildActor(actor, withSuggestions(build, sources), sources);
    warnings.push(...result.warnings.map((warning) => `${level}: ${warning}`));
    actor = result.definition;
    actors.push(actor);
  }
  return { actors, warnings };
}

const action = (actor: CreatureDefinition, name: string): ActionDefinition | undefined =>
  getExecutableActions(actor).find((candidate) => candidate.name === name);
const featureNames = (actor: CreatureDefinition) => [...(actor.features ?? []), ...(actor.traits ?? [])].map((feature) => feature.name);
const slots = (actor: CreatureDefinition) => [1, 2, 3, 4, 5].map((level) => actor.resources?.[`slot-${level}`] ?? 0);

describe("the party's homebrew", () => {
  it("passes its schemas and builds at every level without a problem", { timeout: 60000 }, () => {
    for (const item of PARTY_HOMEBREW) {
      expect(parseCatalogEntry(item).problem, item.entry.id).toBeUndefined();
      expect(entryProblems(item, SRD_BUILD_SOURCES, PARTY_HOMEBREW), item.entry.id).toEqual([]);
    }
  });

  it("is the importable file, kept up to date (scripts/write-party-homebrew.ts writes it)", () => {
    const file = JSON.parse(readFileSync("tests/fixtures/homebrew/party.catalog.json", "utf-8"));
    expect(file).toEqual(JSON.parse(JSON.stringify(catalogFile(PARTY_HOMEBREW, new Date(file.exportedAt)))));
    expect(readCatalogFile(file)).toEqual({ entries: JSON.parse(JSON.stringify(PARTY_HOMEBREW)), problems: [] });
  });

  it("the Arcane Trickster levels from 1 to 20 as a third caster on the Rogue", { timeout: 60000 }, () => {
    const { actors, warnings } = levelUp("srd:class:rogue", ARCANE_TRICKSTER.id);
    expect(warnings).toEqual([]);
    const [two, three, twenty] = [actors[1]!, actors[2]!, actors[19]!];
    expect(slots(two)).toEqual([0, 0, 0, 0, 0]);
    expect(slots(three)).toEqual([2, 0, 0, 0, 0]);
    expect(slots(twenty)).toEqual([4, 3, 3, 1, 0]);
    expect((three.spells ?? []).map((spell) => spell.name)).toContain("Mage Hand");
    // Mage Hand and two more cantrips at 3rd; three spells prepared.
    expect((three.spells ?? []).filter((spell) => spell.level === 0)).toHaveLength(3);
    expect((three.spells ?? []).filter((spell) => spell.level > 0)).toHaveLength(3);
    expect(featureNames(twenty)).toEqual(expect.arrayContaining(["Sneak Attack", "Magical Ambush", "Versatile Trickster", "Spell Thief"]));
  });

  it("the Zealot levels from 1 to 20: Divine Fury grows, its dice pool, Zealous Presence, Rage of the Gods", { timeout: 60000 }, () => {
    const { actors, warnings } = levelUp("srd:class:barbarian", ZEALOT.id);
    expect(warnings).toEqual([]);
    const fury = (actor: CreatureDefinition) => (actor.features ?? []).find((feature) => feature.name === "Divine Fury")?.effects?.[0];
    expect(fury(actors[2]!)).toMatchObject({ kind: "damage-bonus", damage: [{ dice: "1d6+1", damageType: "radiant" }] });
    expect(fury(actors[19]!)).toMatchObject({ damage: [{ dice: "1d6+10" }] });
    expect([actors[2]!, actors[5]!, actors[11]!, actors[16]!].map((actor) => actor.resources?.["warrior-of-the-gods"])).toEqual([4, 5, 6, 7]);
    expect(action(actors[9]!, "Zealous Presence")).toMatchObject({ kind: "buff", targeting: { count: 10 } });
    const godly = action(actors[13]!, "Rage (Rage of the Gods)") as Extract<ActionDefinition, { kind: "activate-feature" }>;
    expect(godly.condition).toMatchObject({ id: "rage-active", modifiers: { flySpeed: 40 } });
    expect(godly.extraCost).toEqual({ resourceId: "rage", amount: 1 });
  });

  it("the Totem Warrior levels from 1 to 20, the Bear chosen by Quick build", { timeout: 60000 }, () => {
    const { actors, warnings } = levelUp("srd:class:barbarian", TOTEM_WARRIOR.id);
    expect(warnings).toEqual([]);
    const bear = (actors[2]!.features ?? []).find((feature) => feature.name === "Totem Spirit: Bear")!;
    expect(bear.effects).toHaveLength(9);
    expect(featureNames(actors[19]!)).toEqual(expect.arrayContaining(["Aspect of the Bear", "Spirit Walker", "Totemic Attunement: Bear"]));
  });

  it("the Spiritbound Marksman levels from 1 to 20 on each path: its gun's shots, its path's range, its own spells", { timeout: 120000 }, () => {
    const ranges = new Map([[DEADEYE.id, [60, 120]], [SILENT_VEIL.id, [120, 300]], [BAYOU_BLIGHT.id, [30, 90]]]);
    const own = new Set(SPIRITBOUND_MARKSMAN.spellcasting!.spells!.map((id) => sources.library.spell?.(id)?.name));
    for (const [path, [range, longRange]] of ranges) {
      const { actors, warnings } = levelUp(SPIRITBOUND_MARKSMAN.id, path);
      expect(warnings, path).toEqual([]);
      const gun = (actor: CreatureDefinition) => getExecutableActions(actor).find((candidate) => candidate.id === GUN) as Extract<ActionDefinition, { kind: "attack" }>;
      expect(gun(actors[0]!)).toMatchObject({ range: 120, attackType: "spell" });
      expect(gun(actors[2]!)).toMatchObject({ range, longRange });
      const volley = (actor: CreatureDefinition) => (action(actor, "Spiritfire Volley") as Extract<ActionDefinition, { kind: "multiattack" }>).attacks[0]!.count;
      expect([0, 4, 10, 16].map((index) => volley(actors[index]!))).toEqual([1, 2, 3, 4]);
      expect(slots(actors[0]!)).toEqual([2, 0, 0, 0, 0]);
      expect(slots(actors[19]!)).toEqual([4, 3, 3, 3, 2]);
      const classSpells = (actors[19]!.spells ?? []).filter((spell) => spell.spellClass === "spiritbound-marksman");
      expect(classSpells.length).toBeGreaterThan(10);
      // A free cast's copy is named after the spell ("Invisibility (free)": Whisper in the Fog's).
      for (const spell of classSpells) expect(own.has(spell.name.replace(/ \(free\)$/, "")), spell.name).toBe(true);
      expect(action(actors[17]!, "Avatar of the Forgotten")).toBeTruthy();
    }
  });

  it("each of them, at 1st, 6th and 20th level, fights the sample encounter with only legal actions", { timeout: 180000 }, () => {
    const problems: string[] = [];
    const characters: Array<[string, string]> = [
      ["srd:class:rogue", ARCANE_TRICKSTER.id], ["srd:class:barbarian", ZEALOT.id], ["srd:class:barbarian", TOTEM_WARRIOR.id],
      [SPIRITBOUND_MARKSMAN.id, DEADEYE.id], [SPIRITBOUND_MARKSMAN.id, SILENT_VEIL.id], [SPIRITBOUND_MARKSMAN.id, BAYOU_BLIGHT.id]
    ];
    for (const [classId, subclassId] of characters) {
      const { actors } = levelUp(classId, subclassId);
      for (const level of [1, 6, 20]) {
        const actor = actors[level - 1]!;
        const parsed = creatureDefinitionSchema.safeParse(actor);
        if (!parsed.success) problems.push(`${subclassId} ${level}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
        const snapshot = structuredClone(sampleEncounter);
        snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), actor];
        for (const token of snapshot.combatants) {
          if (token.id === "pc-fighter") { token.currentHp = actor.maxHp; token.resources = { ...(actor.resources ?? {}) }; }
        }
        const result = runAutomatedEncounter({ ...snapshot, seed: `${subclassId}-${level}` }, 6);
        for (const warning of result.outcome.warnings) problems.push(`${subclassId} ${level}: ${warning}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
