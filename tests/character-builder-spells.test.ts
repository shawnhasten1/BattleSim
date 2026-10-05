import { describe, expect, it } from "vitest";
import {
  createEngineState,
  creatureDefinitionSchema,
  getExecutableActions,
  resolveHealingAction,
  sampleEncounter,
  type CreatureDefinition,
  type SpellDefinition
} from "@/engine";
import { runAutomatedEncounter } from "@/engine/turns";
import { SRD_2024_CATALOG } from "@/data/srd/2024";
import {
  blankCharacter,
  buildCharacter,
  quickBuild,
  rebuildActor,
  withChoice,
  withLevelDown,
  withLevelUp,
  withSuggestions,
  type BuildSources,
  type CharacterBuild,
  type ChoiceSlot,
  type ClassDefinition,
  type SubclassDefinition
} from "@/lib/character-builder";
import { SRD_BUILDER_LIBRARY, SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { castAs, maxSpellLevel, spellRuns } from "@/lib/character-builder/spells";

/** PC builder plan, Phase 5a: spell choices, granted spells and free casts, on a test caster (the SRD's come in 5b). */

const id = (slug: string) => `srd:spell:${slug}-2024`;
const FULL_PREPARED = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25];
const FULL_CANTRIPS = [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];

const MAGE: ClassDefinition = {
  id: "test:class:mage", name: "Mage", source: { provider: "homebrew" }, edition: "2024", hitDie: 6,
  primaryAbilities: ["int"], saves: ["int", "wis"], skills: { count: 2, from: ["arcana", "history"] },
  weaponProficiency: ["simple"], armorTraining: [],
  spellcasting: { ability: "int", kind: "full", list: "wizard", cantrips: FULL_CANTRIPS, prepared: FULL_PREPARED, spellbook: { start: 6, perLevel: 2 } },
  subclassLevel: 3, subclassLabel: "Mage Subclass", featLevels: [4, 8, 12, 16], table: [],
  levels: [{ level: 3, grants: [], choices: [{ kind: "subclass", id: "subclass" }] }],
  suggested: {
    abilities: ["int", "con", "dex", "wis", "cha", "str"], tactics: "controller",
    cantrips: [id("fire-bolt"), id("ray-of-frost")],
    spells: [id("magic-missile"), id("shield"), id("burning-hands"), id("fireball")]
  }
};

/** A subclass whose 3rd level makes Shield always prepared. */
const WARDED: SubclassDefinition = {
  id: "test:subclass:warded", name: "Warded", source: { provider: "homebrew" }, edition: "2024", classId: MAGE.id,
  levels: [{ level: 3, grants: [{ key: "warded-spells", spells: [id("shield")] }] }]
};

const sources: BuildSources = {
  catalog: { ...SRD_2024_CATALOG, classes: [...SRD_2024_CATALOG.classes, MAGE], subclasses: [...SRD_2024_CATALOG.subclasses, WARDED] },
  library: SRD_BUILDER_LIBRARY
};

/** A quick-built mage. A Soldier, so no Magic Initiate spells join the class's. */
const mage = (level: number, extra: Partial<Parameters<typeof quickBuild>[1]> = {}): CharacterBuild =>
  quickBuild(sources, { classId: MAGE.id, level, backgroundId: "srd:background:soldier", ...extra });
const spellSlotsOf = (build: CharacterBuild, characterLevel: number) =>
  buildCharacter(build, sources).choices.filter((slot) => slot.spec.kind === "spells" && slot.characterLevel === characterLevel);
const slotAt = (build: CharacterBuild, characterLevel: number, choice: string): ChoiceSlot =>
  spellSlotsOf(build, characterLevel).find((slot) => slot.path[0] === choice)!;
const spellOn = (definition: CreatureDefinition, spellId: string): SpellDefinition => {
  const found = definition.spells?.find((spell) => spell.id === spellId);
  if (!found) throw new Error(`no ${spellId}: ${(definition.spells ?? []).map((spell) => spell.id).join(", ")}`);
  return found;
};

describe("a caster's spell choices", () => {
  it("asks for cantrips, spellbook spells and prepared spells as its table's numbers rise", () => {
    const build = mage(4);
    expect(spellSlotsOf(build, 1).map((slot) => [slot.path[0], slot.count])).toEqual([["cantrips", 3], ["spellbook", 6], ["prepared", 4]]);
    expect(spellSlotsOf(build, 2).map((slot) => [slot.path[0], slot.count])).toEqual([["spellbook", 2], ["prepared", 1]]);
    expect(spellSlotsOf(build, 4).map((slot) => [slot.path[0], slot.count])).toEqual([["cantrips", 1], ["spellbook", 2], ["prepared", 1]]);
  });

  it("offers the class's list up to the highest level it can cast, and prepares from the spellbook", () => {
    const build = mage(3);
    const book = slotAt(build, 3, "spellbook");
    expect(Math.max(...book.options.map((option) => option.level ?? 0))).toBe(2);
    expect(book.options.some((option) => option.id === id("misty-step"))).toBe(true);
    expect(book.options.some((option) => option.id === id("cure-wounds"))).toBe(false); // not a wizard spell
    const prepared = slotAt(build, 1, "prepared");
    expect(prepared.options.map((option) => option.id).sort()).toEqual([...(slotAt(build, 1, "spellbook").value as string[])].sort());
    expect(maxSpellLevel("full", 5)).toBe(3);
    expect(maxSpellLevel("half", 5)).toBe(2);
    expect(maxSpellLevel("pact", 9)).toBe(5);
  });

  it("suggests spells that run, the highest level it can, then the class's preferences", () => {
    const built = buildCharacter(mage(5), sources);
    const at = (level: number, choice: string) => built.choices.find((slot) => slot.characterLevel === level && slot.path[0] === choice)!.value as string[];
    expect(at(1, "cantrips").slice(0, 2)).toEqual([id("fire-bolt"), id("ray-of-frost")]);
    // Shield would be next, but Warded makes it always prepared at 3rd level.
    expect(at(1, "prepared").slice(0, 2)).toEqual([id("magic-missile"), id("burning-hands")]);
    const fifth = at(5, "prepared").map((spellId) => SRD_BUILDER_LIBRARY.spell!(spellId)!);
    expect(fifth.map((spell) => spell.level)).toEqual([3, 3]);
    // The class's preference first, then the Wizard's (the list it chooses from).
    expect(fifth.map((spell) => spell.name)).toEqual(["Fireball", "Lightning Bolt"]);
    for (const spell of built.spells) expect(spellRuns(spell.spell) || spell.spell.level === 0, spell.spell.name).toBe(true);
  });

  it("refuses a spell that isn't on its list, one it has, or more than it may take", () => {
    let build = mage(1);
    build = withChoice(build, { kind: "level", index: 0 }, ["cantrips"], [id("sacred-flame"), id("fire-bolt"), id("fire-bolt")]);
    const slot = slotAt(build, 1, "cantrips");
    expect(slot.value).toEqual([id("fire-bolt")]);
    expect(slot.problem).toMatch(/Sacred Flame isn't one of the spells/);
    expect(slot.pending).toBe(true);
    const tooMany = withChoice(build, { kind: "level", index: 0 }, ["cantrips"], [id("fire-bolt"), id("ray-of-frost"), id("shocking-grasp"), id("acid-splash")]);
    expect(slotAt(tooMany, 1, "cantrips").value).toHaveLength(3);
  });

  it("asks again for an earlier pick a later grant makes always prepared", () => {
    // Shield prepared at 1st level; Warded makes it always prepared at 3rd.
    let build = mage(2);
    expect(slotAt(build, 1, "prepared").value).toContain(id("shield"));
    build = withChoice(withLevelUp(build), { kind: "level", index: 2 }, ["subclass"], WARDED.id);
    const stale = slotAt(build, 1, "prepared");
    expect(stale.value).not.toContain(id("shield"));
    expect(stale.problem).toMatch(/Shield is always prepared \(Warded\)/);
    expect(stale.pending).toBe(true);
    const fixed = withSuggestions(build, sources);
    expect(slotAt(fixed, 1, "prepared").pending).toBe(false);
    const { definition } = rebuildActor(blankCharacter("def-mage", "Mage"), fixed, sources);
    expect(definition.spells!.filter((spell) => spell.name === "Shield").map((spell) => spell.id)).toEqual(["warded-shield"]);
  });
});

describe("spells on the actor", () => {
  it("are cast with the class's ability, follow it, and say where they came from", () => {
    const { definition } = rebuildActor(blankCharacter("def-mage", "Mage"), mage(5), sources);
    expect(definition.spellcasting).toEqual({ ability: "int" });
    const fireball = spellOn(definition, "mage-fireball");
    expect(fireball.action).toMatchObject({ id: "mage-fireball-action", dcFormula: { ability: "spellcasting" }, resourceCost: { resourceId: "slot-3" } });
    expect(fireball.source).toMatchObject({ documentKey: "srd-2024" });
    expect(definition.resources).toMatchObject({ "slot-1": 4, "slot-2": 3, "slot-3": 2 });
    expect(creatureDefinitionSchema.safeParse(definition).success).toBe(true);
    // Spellbook spells that aren't prepared stay in the build.
    const book = buildCharacter(mage(5), sources).choices.filter((slot) => slot.path[0] === "spellbook").flatMap((slot) => slot.value as string[]);
    const prepared = definition.spells!.filter((spell) => spell.level > 0);
    expect(book.length).toBe(14);
    expect(prepared.length).toBe(9 + 1); // and Warded's Shield
    // Shield is in the book too, but prepared by Warded, not counted against the nine.
    expect(prepared.filter((spell) => spell.name === "Shield").map((spell) => spell.id)).toEqual(["warded-shield"]);
  });

  it("are the same for the same build, and survive an export", () => {
    const first = rebuildActor(blankCharacter("def-mage", "Mage"), mage(7), sources).definition;
    const second = rebuildActor(blankCharacter("def-mage", "Mage"), mage(7), sources).definition;
    expect(second.spells).toEqual(first.spells);
    const again = rebuildActor(structuredClone(first), first.character!.build as CharacterBuild, sources);
    expect(again.changes.filter((change) => change.kind !== "field")).toEqual([]);
  });

  it("keep the DM's edits, and the DM's own spells", () => {
    const made = rebuildActor(blankCharacter("def-mage", "Mage"), mage(4), sources).definition;
    const edited: CreatureDefinition = {
      ...made,
      spells: [
        ...made.spells!.map((spell) => (spell.id === "mage-magic-missile" ? { ...spell, name: "Magic Missile (house rule)" } : spell)),
        { id: "my-own", name: "My Own Spell", level: 1, castingTime: "action", range: 60, automationSupport: "manual-only" }
      ]
    };
    const next = rebuildActor(edited, withSuggestions(withLevelUp(made.character!.build as CharacterBuild), sources), sources);
    expect(spellOn(next.definition, "mage-magic-missile").name).toBe("Magic Missile (house rule)");
    expect(spellOn(next.definition, "my-own").name).toBe("My Own Spell");
    expect(next.changes).toContainEqual(expect.objectContaining({ kind: "kept", key: "spell:mage-magic-missile", reason: "edited" }));
    expect(next.changes.some((change) => change.kind === "gained" && change.key.startsWith("spell:"))).toBe(true);
  });

  it("go when the level that chose them goes", () => {
    const fifth = rebuildActor(blankCharacter("def-mage", "Mage"), mage(5), sources).definition;
    const fourth = rebuildActor(fifth, withLevelDown(fifth.character!.build as CharacterBuild), sources);
    expect(fourth.definition.spells!.some((spell) => spell.level === 3)).toBe(false);
    expect(fourth.changes.filter((change) => change.kind === "lost").map((change) => change.name).sort()).toEqual(["Fireball", "Lightning Bolt"]);
    expect(fourth.definition.resources?.["slot-3"]).toBeUndefined();
  });

  it("name their own ability when it isn't the character's spellcasting one", () => {
    const cure = SRD_BUILDER_LIBRARY.spell!(id("cure-wounds"))!;
    expect(castAs(structuredClone(cure), "wis", "wis").action).toMatchObject({ healing: [{ abilityModifier: "wis" }] });
    const bolt = SRD_BUILDER_LIBRARY.spell!(id("guiding-bolt"))!;
    expect(castAs(structuredClone(bolt), "wis", "int").action).toMatchObject({ attackBonusFormula: { ability: "wis" } });
    expect(castAs(structuredClone(bolt), "int", "int").action).toMatchObject({ attackBonusFormula: { ability: "spellcasting" } });
  });
});

describe("Magic Initiate", () => {
  it("gives the Acolyte two cleric cantrips and a 1st-level spell, cast with its chosen ability", () => {
    const build = quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:fighter", level: 1, backgroundId: "srd:background:acolyte" });
    const built = buildCharacter(build, SRD_BUILD_SOURCES);
    const cantrips = built.choices.find((slot) => slot.scope.kind === "background" && slot.path[0] === "cantrips")!;
    expect(cantrips.count).toBe(2);
    expect(cantrips.options.every((option) => option.level === 0)).toBe(true);
    expect(cantrips.value).toContain(id("sacred-flame"));
    expect(built.choices.some((slot) => slot.path[0] === "list")).toBe(false); // the Acolyte's list is the cleric's
    const ability = built.choices.find((slot) => slot.path[0] === "ability")!;
    expect(ability.value).toEqual(["wis"]); // the fighter's best of Int, Wis and Cha
    expect(built.fields.spellcasting).toEqual({ ability: "wis" });
  });

  it("casts its 1st-level spell once without a slot, and not with slots a fighter doesn't have", () => {
    let build = quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:fighter", level: 1, backgroundId: "srd:background:acolyte" });
    build = withChoice(build, { kind: "background" }, ["spell"], [id("cure-wounds")]);
    const { definition } = rebuildActor(blankCharacter("def-acolyte", "Acolyte"), build, SRD_BUILD_SOURCES);
    expect(definition.spells!.map((spell) => spell.id)).toEqual(expect.arrayContaining(["feat-magic-initiate-cure-wounds-free"]));
    expect(definition.spells!.some((spell) => spell.id === "feat-magic-initiate-cure-wounds")).toBe(false);
    const free = spellOn(definition, "feat-magic-initiate-cure-wounds-free");
    expect(free).toMatchObject({ name: "Cure Wounds (free)", resourceCost: { resourceId: "cure-wounds-free-casts", amount: 1 } });
    expect(free.upcast).toBeUndefined();
    expect(definition.resources?.["cure-wounds-free-casts"]).toBe(1);

    // It heals, and spends its own use.
    const snapshot = structuredClone(sampleEncounter);
    snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
    const fighter = snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    fighter.resources = { ...(definition.resources ?? {}) };
    fighter.currentHp = 1;
    snapshot.round = 1;
    snapshot.turnIndex = snapshot.combatants.indexOf(fighter);
    const state = createEngineState(snapshot);
    const action = getExecutableActions({ ...definition, id: "def-fighter" }).find((candidate) => candidate.name === "Cure Wounds (free)")!;
    resolveHealingAction(state, "pc-fighter", "pc-fighter", action.id);
    const after = state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    expect(after.currentHp).toBeGreaterThan(1);
    expect(after.resources?.["cure-wounds-free-casts"]).toBe(0);
  });

  it("is also cast with slots by a character that has them", () => {
    const build = withChoice(mage(1, { backgroundId: "srd:background:acolyte" }), { kind: "background" }, ["spell"], [id("bless")]);
    const { definition } = rebuildActor(blankCharacter("def-mage", "Mage"), build, sources);
    expect(spellOn(definition, "feat-magic-initiate-bless").resourceCost).toEqual({ resourceId: "slot-1", amount: 1 });
    expect(spellOn(definition, "feat-magic-initiate-bless-free").resourceCost?.resourceId).toBe("bless-free-casts");
    // The mage casts with Intelligence; Magic Initiate's spells with the ability chosen for it.
    expect(definition.spellcasting).toEqual({ ability: "int" });
    const sacredFlame = spellOn(definition, "feat-magic-initiate-sacred-flame");
    const chosen = buildCharacter(build, sources).choices.find((slot) => slot.path[0] === "ability")!.value as string[];
    expect(sacredFlame.action).toMatchObject({ dcFormula: { ability: chosen[0] === "int" ? "spellcasting" : chosen[0] } });
  });
});

describe("a built caster in a fight", () => {
  it("casts its spells when the AI runs it", () => {
    const { definition } = rebuildActor(blankCharacter("def-fighter", "Mage"), mage(5), sources);
    const snapshot = structuredClone(sampleEncounter);
    snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), definition];
    const token = snapshot.combatants.find((candidate) => candidate.id === "pc-fighter")!;
    token.currentHp = definition.maxHp;
    token.resources = { ...(definition.resources ?? {}) };
    const result = runAutomatedEncounter({ ...snapshot, seed: "mage" }, 20);
    const names = new Set(definition.spells!.map((spell) => spell.name));
    const cast = result.log.filter((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "pc-fighter" && names.has(String(entry.data?.actionName)));
    expect(cast.length).toBeGreaterThan(0);
    expect(result.outcome.completed).toBe(true);
  });
});
