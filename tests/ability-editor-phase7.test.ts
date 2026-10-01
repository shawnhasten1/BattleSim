import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sampleEncounter, type ActionDefinition, type CreatureDefinition, type LegendaryActionRef } from "@/engine";
import { loadSrdMonster, loadSrdMonsterAbilities } from "@/data/srd/monsters";
import { RECIPES, prepareMonsterAbility, searchAdd } from "@/lib/ability-editor/add";
import { convertAction } from "@/lib/ability-editor/conversions";
import { checkRecordJson, lineDiff, recordJson } from "@/lib/ability-editor/json";
import {
  blankLegendaryAction,
  legendaryChoices,
  legendaryMode,
  legendaryUsersOf,
  withLegendaryMode,
  withLegendaryPool,
  withoutLegendaryAction,
  type ParkedLegendary
} from "@/lib/ability-editor/legendary";
import { findAbility, withNewAbilityAt, withRecordAfter, type AbilityRef } from "@/lib/ability-editor/refs";
import { sectionsFor } from "@/lib/ability-editor/sections";
import { creaturesToFetch, newSummonLoop, withSpawnsSettled } from "@/lib/ability-editor/spawns";
import { blankAttack, blankDeathEffect, blankHeal, blankLairAction, blankSummon, blankTransform } from "@/lib/ability-editor/templates";
import { abilityList } from "@/lib/ability-editor/list";
import { abilityWarnings } from "@/lib/ability-editor/validate";
import { legendaryLosses, withoutDefinitionItem } from "@/lib/definition-edits";
import { useEncounterStore } from "@/store/encounter-store";

/** Phase 7: legendary actions, lair actions, death effects, summons, shapechanges and standard actions in the editor, and the JSON view. */

let dragon: CreatureDefinition;
beforeAll(async () => { dragon = (await loadSrdMonster("srd:monster:adult-red-dragon"))!; });

const legendaryRef = (index: number): AbilityRef => ({ list: "legendary", index });
const ids = (definition: CreatureDefinition, ref: AbilityRef) => sectionsFor({ ref, record: findAbility(definition, ref)!, definition }).map((section) => section.id);
const summary = (definition: CreatureDefinition, ref: AbilityRef, id: string) =>
  sectionsFor({ ref, record: findAbility(definition, ref)!, definition }).find((section) => section.id === id)?.summary;
const warningIds = (definition: CreatureDefinition, where: Parameters<typeof abilityWarnings>[1], record: Parameters<typeof abilityWarnings>[2]) =>
  abilityWarnings(definition, where, record).map((warning) => warning.id);

/** The sample fighter, with whatever it's given. */
function fighter(patch: Partial<CreatureDefinition> = {}): CreatureDefinition {
  return { ...structuredClone(sampleEncounter.definitions.find((d) => d.id === "def-fighter")!), ...patch };
}

describe("legendary actions", () => {
  it("offers the creature's abilities to use, grouped by kind", () => {
    expect(legendaryChoices(dragon).map((choice) => `${choice.group}: ${choice.label}`)).toEqual([
      "Attacks: Bite", "Attacks: Claw", "Attacks: Tail", "Multiattacks: Multiattack", "Saves and areas: Frightful Presence", "Saves and areas: Fire Breath"
    ]);
  });

  it("switches between using an ability, one of its own and reference text, keeping the others for the session", () => {
    const tailAttack = dragon.legendary!.actions[1]!;
    expect(legendaryMode(tailAttack)).toBe("uses");
    let parked: ParkedLegendary = {};
    const own = withLegendaryMode(tailAttack, "own", parked, dragon);
    parked = own.parked;
    // Its own ability starts as a copy of the tail attack: legendary points are all it spends.
    expect(own.entry.actionId).toBeUndefined();
    expect(own.entry.action).toMatchObject({ kind: "attack", name: "Tail Attack", id: "", actionType: "action", reach: 15, attackBonus: 14 });
    const edited = { ...own.entry, action: { ...own.entry.action!, reach: 20 } as ActionDefinition };
    const back = withLegendaryMode(edited, "uses", parked, dragon);
    expect(back.entry).toMatchObject({ actionId: "tail" });
    expect(back.entry.action).toBeUndefined();
    const reference = withLegendaryMode(back.entry, "reference", back.parked, dragon);
    expect(legendaryMode(reference.entry)).toBe("reference");
    // The edited ability of its own comes back.
    expect(withLegendaryMode(reference.entry, "own", reference.parked, dragon).entry.action).toMatchObject({ reach: 20 });
  });

  it("starts a new one on the creature's first attack, or as reference text with nothing to use", () => {
    expect(blankLegendaryAction(dragon)).toEqual({ name: "Bite Attack", cost: 1, description: "", actionId: "bite" });
    expect(blankLegendaryAction(fighter({ actions: [], weapons: [] }))).toEqual({ name: "New legendary action", cost: 1, description: "" });
  });

  it("sets how many it takes a round, keeping its listed points in step; deleting the last one removes them", () => {
    const two = withLegendaryPool(dragon, 2);
    expect(two.legendary!.pool).toBe(2);
    expect(two.resources!["legendary-points"]).toBe(2);
    expect(withLegendaryPool(fighter(), 2)).toEqual(fighter());
    let left = dragon;
    for (let i = 0; i < 3; i += 1) left = withoutLegendaryAction(left, 0);
    expect(left.legendary).toBeUndefined();
    expect(left.resources!["legendary-points"]).toBeUndefined();
    expect(left.resources!["legendary-resistance"]).toBe(3);
  });

  it("has its cost and pool, what it does, and an ability of its own's sections", () => {
    expect(ids(dragon, legendaryRef(1))).toEqual(["basics", "use", "does", "notes"]);
    expect(summary(dragon, legendaryRef(1), "use")).toBe("costs 1 legendary action · 3 a round");
    expect(summary(dragon, legendaryRef(1), "does")).toBe("uses its Tail");
    expect(summary(dragon, legendaryRef(0), "does")).toBe("reference only");
    expect(ids(dragon, legendaryRef(2))).toEqual(["basics", "use", "does", "target", "roll", "damage", "effects", "lingering", "notes"]);
    expect(summary(dragon, legendaryRef(2), "does")).toBe("its own ability · area");
  });

  it("warns about an ability it doesn't have, and one the AI never takes between turns", () => {
    const gone: LegendaryActionRef = { name: "Swipe", cost: 1, description: "", actionId: "nothing" };
    expect(warningIds(dragon, "legendary", gone)).toContain("legendary-missing-ability");
    const heal: LegendaryActionRef = { name: "Mend", cost: 2, description: "", action: blankHeal() };
    expect(warningIds(dragon, "legendary", heal)).toContain("legendary-never-taken");
    expect(warningIds(dragon, legendaryRef(1), dragon.legendary!.actions[1]!)).toEqual([]);
  });

  it("goes after the one it copies, and is previewed where it's going", () => {
    const placed = withNewAbilityAt(dragon, "legendary", { name: "Copy", cost: 1, description: "" });
    expect(placed.ref).toEqual(legendaryRef(3));
    const moved = withRecordAfter(placed.definition, placed.ref, "0");
    expect(moved.definition.legendary!.actions.map((entry) => entry.name)).toEqual(["Detect", "Copy", "Tail Attack", "Wing Attack"]);
    expect(moved.ref).toEqual(legendaryRef(1));
  });
});

describe("deleting what a legendary action uses", () => {
  it("asks first, and makes it reference text, or uses the replacement", () => {
    expect(legendaryLosses(dragon, "action", "tail").map((loss) => loss.entry.name)).toEqual(["Tail Attack"]);
    expect(legendaryLosses(dragon, "action", "claw")).toEqual([]);
    expect(withoutDefinitionItem(dragon, "action", "tail").legendary!.actions[1]).toEqual({ name: "Tail Attack", cost: 1, description: "The dragon makes a tail attack." });
    expect(withoutDefinitionItem(dragon, "action", "tail", "id:claw").legendary!.actions[1]).toMatchObject({ actionId: "claw" });
    expect(legendaryUsersOf(dragon, new Set(["tail"])).map((user) => user.index)).toEqual([1]);
  });

  it("deletes a legendary action itself by its place", () => {
    expect(withoutDefinitionItem(dragon, "legendary", "0").legendary!.actions.map((entry) => entry.name)).toEqual(["Tail Attack", "Wing Attack"]);
  });
});

describe("death effects and lair actions", () => {
  it("gives a death effect its area, roll, damage and effects, and no cost or lingering area", () => {
    const definition = fighter({ deathEffects: [{ ...blankDeathEffect(), id: "burst" }] });
    expect(ids(definition, { list: "deathEffects", id: "burst" })).toEqual(["basics", "target", "roll", "damage", "effects", "notes"]);
  });

  it("warns about a death effect the engine skips, and one nobody aims", () => {
    const save = { ...blankDeathEffect(), action: { kind: "save", id: "", name: "Curse", actionType: "action", saveAbility: "wis", dc: 12, range: 30, damage: [], halfDamageOnSuccess: false, onSuccess: "negates", automationSupport: "full" } as ActionDefinition };
    expect(warningIds(fighter(), "deathEffects", save)).toContain("death-not-area");
    const cone = blankDeathEffect();
    (cone.action as Extract<ActionDefinition, { kind: "area-save" }>).area = { type: "cone", size: 15 };
    expect(warningIds(fighter(), "deathEffects", cone)).toContain("death-aimed");
    expect(warningIds(fighter(), "deathEffects", blankDeathEffect())).toEqual([]);
  });

  it("says when a lair action happens, and warns about one the lair never takes", () => {
    const definition = fighter({ lairActions: [{ ...blankLairAction(), id: "eruption" }] });
    expect(summary(definition, { list: "lairActions", id: "eruption" }, "use")).toBe("initiative 20, in its lair");
    expect(warningIds(fighter(), "lairActions", blankHeal())).toContain("lair-never-taken");
    expect(warningIds(fighter(), "lairActions", blankLairAction())).toEqual([]);
  });
});

describe("one row per ability on the SRD monsters", () => {
  const chunks = join(process.cwd(), "src/data/srd/monsters/generated/chunks");
  const monsters: CreatureDefinition[] = readdirSync(chunks).flatMap((file) => (JSON.parse(readFileSync(join(chunks, file), "utf8")) as { definitions: CreatureDefinition[] }).definitions);
  const byId = (id: string) => monsters.find((monster) => monster.id === id)!;

  it("lists no ability twice: only a legendary action named after the action it uses shares a name", () => {
    const twice = monsters.flatMap((monster) => {
      const groups = abilityList(monster).flatMap((group) => [...group.rows, ...(group.levels ?? []).flatMap((level) => level.rows)].map((row) => ({ group: group.id, name: row.name })));
      return [...new Set(groups.map((row) => row.name))]
        .filter((name) => groups.filter((row) => row.name === name && row.group !== "legendary").length > 1)
        .map((name) => `${monster.name}: ${name}`);
    });
    expect(twice).toEqual([]);
  });

  it("keeps the statblock's text on the row that's left", () => {
    const werewolf = byId("srd:monster:werewolf");
    expect(werewolf.traits?.some((trait) => /^Shapechanger/.test(trait.name))).toBe(false);
    expect(werewolf.actions.find((action) => action.kind === "transform")!.description).toMatch(/^The werewolf can use its action to polymorph/);
    // Every form has the same action, text and all.
    expect(byId("srd:monster:werewolf--wolf").actions.find((action) => action.kind === "transform")!.description).toMatch(/^The werewolf can use its action/);
    const mephit = byId("srd:monster:dust-mephit");
    expect(mephit.traits?.some((trait) => trait.name === "Death Burst")).toBe(false);
    expect(mephit.deathEffects![0]!.description).toMatch(/^When the mephit dies, it explodes/);
    expect(byId("srd:monster:balor").traits?.some((trait) => trait.name === "Death Throes")).toBe(false);
  });

  it("says the AI never changes shape on its own, on the shapechange row", () => {
    const werewolf = byId("srd:monster:werewolf");
    const shift = abilityList(werewolf).flatMap((group) => group.rows).find((row) => row.name === "Shapechanger")!;
    expect(shift).toMatchObject({ automation: "partial" });
    expect(shift.automationNote).toContain("The AI never changes shape on its own.");
  });
});

describe("summons, shapechanges and standard actions", () => {
  it("switches an attack to a summon, a shapechange or a standard action, and back", () => {
    const bite = { ...blankAttack(), id: "bite", name: "Bite", usage: { kind: "uses" as const, uses: 1 }, resourceCost: { resourceId: "usage:bite", amount: 1 } };
    const summon = convertAction(bite, "summon");
    expect(summon.action).toMatchObject({ kind: "summon", id: "bite", name: "Bite", options: [], choice: "pick", durationRounds: 10, usage: { kind: "uses" } });
    expect(convertAction(summon.action, "attack", summon.parked).action).toMatchObject({ kind: "attack", damage: bite.damage });
    const transform = convertAction(bite, "transform").action;
    expect(transform).toMatchObject({ kind: "transform", forms: [], canRevert: true, revertOnDeath: true });
    expect("resourceCost" in transform).toBe(false);
    const dash = convertAction({ ...bite, actionType: "reaction" } as ActionDefinition, "utility").action;
    expect(dash).toMatchObject({ kind: "utility", mode: "dash", actionType: "action", automationSupport: "full" });
  });

  it("gives each its own outcome section, and warns while there's nothing to summon or become", () => {
    const definition = fighter({ actions: [{ ...blankSummon(), id: "call", options: [{ id: "wolf", definitionId: "srd:monster:wolf", label: "Wolf", count: { dice: "1d4" } }], chance: 50 }, { ...blankTransform(), id: "shift" }] });
    const outcome = (id: string) => sectionsFor({ ref: { list: "actions", id }, record: findAbility(definition, { list: "actions", id })!, definition }).find((section) => section.id === "outcome");
    expect(outcome("call")).toEqual({ id: "outcome", title: "Summon", summary: "summons 1d4 Wolf · 50% chance · 1 minute" });
    expect(outcome("shift")).toEqual({ id: "outcome", title: "Shapechange", summary: "no forms yet" });
    expect(warningIds(definition, { list: "actions", id: "shift" }, findAbility(definition, { list: "actions", id: "shift" })!)).toContain("transform-empty");
    expect(warningIds(fighter(), "actions", blankSummon())).toContain("summon-empty");
  });
});

describe("the creatures summons and shapechanges name", () => {
  it("embeds what the scene lacks, and puts a shapechange on each of its forms", () => {
    const wolf = { ...fighter(), id: "wolf-form", name: "Wolf form", actions: [] };
    const owner = fighter({ id: "owner", actions: [{ ...blankTransform(), id: "shift", forms: [{ id: "wolf", label: "Wolf", definitionId: "wolf-form" }] }] });
    const scene = withSpawnsSettled([owner], owner, [wolf]);
    expect(scene.map((definition) => definition.id)).toEqual(["owner", "wolf-form"]);
    expect(scene[1]!.actions.map((action) => action.id)).toEqual(["shift"]);
    // Saving again replaces the copy, by id.
    const renamed = { ...owner, actions: [{ ...owner.actions[0]!, name: "Change Shape" }] };
    expect(withSpawnsSettled(scene, renamed)[1]!.actions.map((action) => action.name)).toEqual(["Change Shape"]);
  });

  it("finds a summon loop that saving would make, and not one the scene already has", () => {
    const summoning = (id: string, target: string): CreatureDefinition => fighter({ id, actions: [{ ...blankSummon(), id: "call", options: [{ id: target, definitionId: target, label: target, count: 1 }] }] });
    const b = summoning("b", "a");
    expect(newSummonLoop([fighter({ id: "a" }), b], summoning("a", "b"))).toEqual(["a", "b", "a"]);
    expect(newSummonLoop([summoning("a", "b"), b], summoning("a", "b"))).toBeUndefined();
  });

  it("lists the library creatures still to fetch", () => {
    const owner = fighter({ id: "owner", actions: [{ ...blankSummon(), id: "call", options: [{ id: "wolf", definitionId: "srd:monster:wolf", label: "Wolf", count: 1 }] }] });
    expect(creaturesToFetch(owner, [owner], [], [])).toEqual(["srd:monster:wolf"]);
    expect(creaturesToFetch(owner, [owner], [], ["srd:monster:wolf"])).toEqual([]);
  });
});

describe("the JSON view", () => {
  const claw = () => findAbility(dragon, { list: "actions", id: "claw" })!;
  const check = (text: string, ref: AbilityRef = { list: "actions", id: "claw" }) => checkRecordJson(text, findAbility(dragon, ref)!, ref, dragon);

  it("says where the JSON stops parsing, and why", () => {
    const message = (text: string) => {
      const result = check(text);
      return result.ok ? "" : result.problems[0]!.message;
    };
    expect(message("{\n  \"name\": \"Claw\",\n  oops\n}")).toBe("Line 3, column 3: Expected a name in double quotes");
    expect(message("{\n  \"name\": \"Claw\",\n}")).toBe("Line 2, column 17: A comma can't come right before }");
    expect(message("{ \"name\" \"Claw\" }")).toBe("Line 1, column 10: Expected a colon after the name");
    expect(message("{ \"name\": \"Claw }")).toBe("Line 1, column 18: A string isn't closed");
    expect(message("{ \"name\": \"Claw\" }  x")).toBe("Line 1, column 21: There's more after the record");
  });

  it("checks the parts with the engine's schemas, and what each kind needs", () => {
    const bad = { ...claw(), damage: [{ dice: "", damageType: "slashing" }], riders: [{ kind: "teleport", when: "on-hit" }] };
    const result = check(JSON.stringify(bad));
    expect(!result.ok && result.problems.map((problem) => problem.path)).toEqual(expect.arrayContaining(["damage[0].dice", "riders[0].kind"]));
    expect(check(JSON.stringify({ ...claw(), kind: "laser" })).ok).toBe(false);
    const legendary = checkRecordJson(JSON.stringify({ ...dragon.legendary!.actions[1]!, cost: 4 }), dragon.legendary!.actions[1]!, legendaryRef(1), dragon);
    expect(!legendary.ok && legendary.problems[0]!.path).toBe("cost");
  });

  it("accepts a grapple and a swallow, which the rider schema covers now", () => {
    const grappling = { ...claw(), riders: [{ kind: "hold", when: "on-hit", escapeDc: 17, maxSize: "large" }, { kind: "swallow", when: "on-hit", requiresHeld: true, capacity: 1 }] };
    expect(check(JSON.stringify(grappling)).ok).toBe(true);
  });

  it("shows what changes, normalized as a save would store it, with its ids kept", () => {
    expect(check(recordJson(claw()))).toMatchObject({ ok: true, changed: false });
    const renamed = check(JSON.stringify({ ...claw(), name: "Talon", id: "something-else" }, null, 2));
    expect(renamed.ok && renamed.record).toMatchObject({ name: "Talon", id: "claw" });
    expect(renamed.ok && renamed.diff.filter((line) => line.kind !== "same").map((line) => `${line.kind} ${line.text.trim()}`)).toEqual([
      "removed \"name\": \"Claw\",", "added \"name\": \"Talon\","
    ]);
  });

  it("keeps a new ability's ids as they are until it's added", () => {
    const entry: LegendaryActionRef = { name: "Gust", cost: 2, description: "", action: { ...blankAttack(), id: "", name: "Gust" } };
    const result = checkRecordJson(recordJson({ ...entry, cost: 3 }), entry, "legendary", dragon);
    expect(result.ok && (result.record as LegendaryActionRef).action!.id).toBe("");
    // Only the edit: what a save tidies up anyway (a dice count) isn't shown as a change.
    expect(result.ok && result.diff.filter((line) => line.kind !== "same").map((line) => `${line.kind} ${line.text.trim()}`)).toEqual([
      "removed \"cost\": 2,", "added \"cost\": 3,"
    ]);
  });

  it("diffs by line, keeping what's in common", () => {
    expect(lineDiff("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "same", text: "a" }, { kind: "removed", text: "b" }, { kind: "added", text: "x" }, { kind: "same", text: "c" }
    ]);
  });
});

describe("Add", { timeout: 30000 }, () => {
  it("copies a legendary action that uses its monster's ability with that ability as its own", async () => {
    const abilities = await loadSrdMonsterAbilities();
    // Dragons with the same tail attack share one entry.
    const entry = searchAdd("tail attack", "monster", abilities).monster.find((candidate) => candidate.list === "legendary" && candidate.name === "Tail Attack")!;
    expect(entry.text).toMatch(/^legendary \(1 action\) · uses Tail · /);
    const prepared = (await prepareMonsterAbility(entry))!;
    expect(prepared.list).toBe("legendary");
    expect(prepared.record).toMatchObject({ name: "Tail Attack", cost: 1, action: { kind: "attack", name: "Tail Attack", reach: 15 } });
    expect((prepared.record as LegendaryActionRef).actionId).toBeUndefined();
    const burst = searchAdd("death burst", "monster", abilities).monster.find((candidate) => candidate.list === "deathEffects")!;
    expect((await prepareMonsterAbility(burst))!).toMatchObject({ list: "deathEffects", record: { name: "Death Burst", action: { kind: "area-save" } } });
  });

  it("has a death burst recipe", () => {
    const recipe = RECIPES.find((candidate) => candidate.id === "death:death-burst")!;
    expect(recipe.prepare(fighter())).toMatchObject({ list: "deathEffects", record: { action: { kind: "area-save", saveAbility: "con", riders: [{ condition: "poisoned" }] } } });
  });
});

describe("the store", () => {
  const pristine = useEncounterStore.getState();
  beforeEach(() => useEncounterStore.setState(pristine, true));
  const store = () => useEncounterStore.getState();
  const fighterNow = () => store().encounter.definitions.find((d) => d.id === "def-fighter")!;

  it("adds a first legendary action with how many a round, in one undo step", () => {
    const depth = store().undoStack.length;
    const ref = store().insertAbilityRecord("def-fighter", "legendary", { name: "Swipe", cost: 1, description: "", actionId: "longsword" }, { legendaryPool: 2 });
    expect(ref).toEqual(legendaryRef(0));
    expect(fighterNow().legendary).toEqual({ pool: 2, actions: [{ name: "Swipe", cost: 1, description: "", actionId: "longsword" }] });
    expect(store().undoStack.length).toBe(depth + 1);
    store().replaceAbilityRecord("def-fighter", legendaryRef(0), { name: "Swipe", cost: 2, description: "" }, { legendaryPool: 1 });
    expect(fighterNow().legendary).toEqual({ pool: 1, actions: [{ name: "Swipe", cost: 2, description: "" }] });
    store().setLegendaryPool("def-fighter", 3);
    expect(fighterNow().legendary!.pool).toBe(3);
  });

  it("gives a legendary action's own ability an id of its own", () => {
    store().insertAbilityRecord("def-fighter", "legendary", { name: "Gust", cost: 2, description: "", action: { ...blankAttack(), id: "", name: "Gust" } });
    store().insertAbilityRecord("def-fighter", "legendary", { name: "Gale", cost: 2, description: "", action: { ...blankAttack(), id: "", name: "Gale" } });
    const [gust, gale] = fighterNow().legendary!.actions;
    expect(gust!.action!.id).toMatch(/^legendary-/);
    expect(gale!.action!.id).not.toBe(gust!.action!.id);
  });

  it("embeds the creatures a summon names in the same undo step", () => {
    const wolf = { ...fighter(), id: "srd:monster:wolf", name: "Wolf" };
    const depth = store().undoStack.length;
    store().insertAbilityRecord("def-fighter", "actions", { ...blankSummon(), options: [{ id: "wolf", definitionId: wolf.id, label: "Wolf", count: 1 }] }, { embed: [wolf] });
    expect(store().encounter.definitions.some((definition) => definition.id === "srd:monster:wolf")).toBe(true);
    expect(store().undoStack.length).toBe(depth + 1);
    store().undo();
    expect(store().encounter.definitions.some((definition) => definition.id === "srd:monster:wolf")).toBe(false);
  });
});
