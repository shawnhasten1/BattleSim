import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getExecutableActions, sampleEncounter, type ActionDefinition, type CreatureDefinition, type FeatureDefinition } from "@/engine";
import { findSrdFeature, findSrdWeapon } from "@/data/srd";
import { SRD_MONSTER_INDEX, loadSrdMonster, loadSrdMonsterAbilities, type SrdMonsterAbilityEntry } from "@/data/srd/monsters";
import { RECIPES, prepareLibrary, prepareMonsterAbility, searchAdd } from "@/lib/ability-editor/add";
import { actionLimit } from "@/lib/ability-editor/bindings";
import { abilityList, duplicateOf, featureGroup, weaponGroup, type ListGroup } from "@/lib/ability-editor/list";
import { resourceRows, resourceSummary } from "@/lib/actor-sheet/resources";
import { findAbility, type AbilityRef } from "@/lib/ability-editor/refs";
import { sectionsFor } from "@/lib/ability-editor/sections";
import { blankSpecialAction, FEATURE_TEMPLATES } from "@/lib/ability-editor/templates";
import { useEncounterStore } from "@/store/encounter-store";

/** Phase 6's models: the list in statblock order, the resources above it, and Add's search, recipes and copies. */

const titles = (groups: ListGroup[]) => groups.map((group) => group.title);
const rowsOf = (groups: ListGroup[], title: string) => groups.find((group) => group.title === title)?.rows ?? [];
const monsters = new Map<string, CreatureDefinition>();
const monster = async (slug: string) => {
  if (!monsters.has(slug)) monsters.set(slug, (await loadSrdMonster(`srd:monster:${slug}`))!);
  return monsters.get(slug)!;
};

/** The sample fighter with Rage, Extra Attack and a Greataxe that can power-attack and swing as a bonus action. */
function fighter(): CreatureDefinition {
  const base = structuredClone(sampleEncounter.definitions.find((d) => d.id === "def-fighter")!);
  const rage = { ...FEATURE_TEMPLATES.find((template) => template.label === "Rage")!.record([]), id: "f-rage" };
  const extra = { ...structuredClone(findSrdFeature("srd:feature:extra-attack")!), id: "f-extra" };
  const greataxe = { ...structuredClone(findSrdWeapon("srd:weapon:greataxe")!), id: "w-axe", actionId: "weapon-action-w-axe", powerAttack: true, usableAs: ["action", "bonus", "reaction"] as Array<"action" | "bonus" | "reaction"> };
  return { ...base, features: [...(base.features ?? []), rage, extra], weapons: [greataxe], resources: { ...base.resources, rage: 3 } };
}

describe("the list, in statblock order", () => {
  it("places a dragon's abilities as its statblock does, a multiattack first, legendary actions with their pool", async () => {
    const groups = abilityList(await monster("adult-red-dragon"));
    expect(titles(groups)).toEqual(["Traits", "Actions", "Legendary actions"]);
    const actions = rowsOf(groups, "Actions");
    expect(actions.map((row) => row.name)).toEqual(["Multiattack", "Bite", "Claw", "Tail", "Frightful Presence", "Fire Breath"]);
    const breath = actions.find((row) => row.name === "Fire Breath")!;
    // The cost is a chip, not repeated in the line.
    expect(breath).toMatchObject({ cost: "Recharge 5–6", automation: "simulated", moves: ["bonus", "reactions"], itemType: "action" });
    expect(breath.line).toBe("60-ft cone · DC 21 DEX · 63 (18d6) fire, half on save");
    expect(groups.find((group) => group.title === "Legendary actions")).toMatchObject({ note: "3 a round" });
    // Legendary actions open in the editor too (Phase 7), and are deleted by their place.
    const detect = rowsOf(groups, "Legendary actions").find((row) => row.name === "Detect")!;
    expect(detect).toMatchObject({ cost: "1 action", automation: "reference", itemType: "legendary", moves: [] });
  });

  it("gives a spellcaster a Spellcasting block: its ability, DC and attack, and spells by level with their slots", async () => {
    const mage = await monster("mage");
    const spellcasting = abilityList(mage).find((group) => group.id === "spellcasting")!;
    expect(spellcasting.note).toBe("Intelligence · save DC 14 · +6 to hit · 9th-level spellcaster");
    expect(spellcasting.levels!.map((level) => `${level.title}${level.slots ? ` (${level.slots})` : ""}`)).toEqual([
      "Cantrips (at will)", "1st level (4 of 4 slots)", "2nd level (3 of 3 slots)", "3rd level (3 of 3 slots)", "4th level (3 of 3 slots)", "5th level (1 of 1 slot)"
    ]);
    const fireball = spellcasting.levels!.find((level) => level.level === 3)!.rows.find((row) => row.name === "Fireball")!;
    expect(fireball.line).toBe("20-ft sphere within 150 ft · DC 14 DEX · 28 (8d6) fire, half on save");
    // Concentration is a chip, not said again in the line.
    const concentrating = spellcasting.levels!.flatMap((level) => level.rows).filter((row) => row.chips.includes("concentration"));
    expect(concentrating.length).toBeGreaterThan(0);
    for (const row of concentrating) expect(row.line, row.name).not.toContain("concentration");
    // A token that has spent a slot shows what's left.
    const token = { ...sampleEncounter.combatants[0]!, resources: { "slot-3": 1 } };
    expect(abilityList(mage, token).find((group) => group.id === "spellcasting")!.levels!.find((level) => level.level === 3)!.slots).toBe("1 of 3 slots");
  });

  it("puts a feature where it's used: Rage and Second Wind with the bonus actions, Extra Attack and Action Surge with the actions", () => {
    const definition = fighter();
    const groups = abilityList(definition);
    expect(titles(groups)).toEqual(["Actions", "Bonus actions"]);
    // Extra Attack's routine first, then the weapons, the creature's own actions, and what its features give.
    expect(rowsOf(groups, "Actions").map((row) => row.name)).toEqual(["Extra Attack", "Greataxe", "Longsword", "Action Surge"]);
    expect(rowsOf(groups, "Bonus actions").map((row) => [row.name, row.cost])).toEqual([["Second Wind", "1 second wind"], ["Rage", "1 rage"]]);
    expect(rowsOf(groups, "Actions").find((row) => row.name === "Greataxe")!.chips).toEqual(["also a bonus action", "power attack"]);
    expect(featureGroup(findSrdFeature("srd:feature:pack-tactics")!)).toBe("traits");
    expect(weaponGroup({ ...findSrdWeapon("srd:weapon:dagger")!, usableAs: ["bonus"] })).toBe("bonus");
  });

  it("shows an optional rule with its switch, where what it grants is used", () => {
    const definition = fighter();
    const variant: FeatureDefinition = {
      id: "f-variant", name: "Variant: Summon Help", category: "trait", optional: true, automationSupport: "full",
      grantedActions: [{ kind: "healing", id: "help", name: "Call Help", actionType: "action", range: 0, healing: [{ dice: "1d4" }], targeting: { target: "self" }, automationSupport: "full" }]
    };
    const row = rowsOf(abilityList({ ...definition, traits: [variant] }), "Actions").find((entry) => entry.name === "Variant: Summon Help")!;
    expect(row).toMatchObject({ enabled: false, chips: ["optional rule"] });
  });

  it("marks a row partly simulated when the AI never uses it, or part of it never happens", () => {
    const definition = fighter();
    const reckless = { ...structuredClone(findSrdFeature("srd:feature:reckless-attack")!), id: "f-reckless" };
    const parry: ActionDefinition = {
      kind: "activate-feature", id: "parry", name: "Parry", actionType: "reaction", featureId: "", targeting: { target: "self" }, automationSupport: "full",
      condition: { name: "custom", durationRounds: 1, modifiers: { armorClassBonus: 2 } },
      reaction: { trigger: { kind: "manual", note: "when a friend calls" } }
    } as ActionDefinition;
    // It spends ki, which the fighter hasn't got.
    const strike = { ...definition.actions.find((action) => action.id === "longsword")!, id: "strike", name: "Ki Strike", resourceCost: { resourceId: "ki", amount: 1 } } as ActionDefinition;
    const groups = abilityList({ ...definition, features: [...definition.features!, reckless], actions: [...definition.actions, strike], reactions: [parry] });
    const note = (title: string, name: string) => rowsOf(groups, title).find((row) => row.name === name)!;
    expect(note("Actions", "Reckless Attack")).toMatchObject({
      automation: "partial",
      automationNote: "Partly simulated. The AI never switches it on by itself: it only takes ones that cost a bonus action, and reactions. Use it by hand in manual play."
    });
    // A manual reaction says so once, not again as a statblock note.
    expect(note("Reactions", "Parry").automationNote).toBe("Partly simulated. Its trigger is described, not simulated, so it never fires on its own.");
    expect(note("Actions", "Ki Strike").automationNote).toBe("Partly simulated. Never usable: this creature has no ki.");
    expect(note("Actions", "Greataxe")).toMatchObject({ automation: "simulated", automationNote: "Simulated: the AI uses it as written." });
  });

  it("moves an action between slots, and a heal never to a reaction", () => {
    const definition = fighter();
    const heal: ActionDefinition = { kind: "healing", id: "salve", name: "Salve", actionType: "action", range: 0, healing: [{ dice: "1d4" }], targeting: { target: "self" }, automationSupport: "full" };
    const rows = rowsOf(abilityList({ ...definition, actions: [...definition.actions, heal] }), "Actions");
    expect(rows.find((row) => row.name === "Longsword")!.moves).toEqual(["bonus", "reactions"]);
    expect(rows.find((row) => row.name === "Salve")!.moves).toEqual(["bonus"]);
  });

  it("duplicates a record as a copy beside its original", () => {
    const copy = duplicateOf(fighter(), { list: "actions", id: "longsword" })!;
    expect(copy).toMatchObject({ list: "actions", after: "longsword", record: { name: "Longsword (copy)", kind: "attack" } });
  });
});

describe("the resources above the list, folded", () => {
  it("say what recharges, what has uses or a pool, and the legendary actions a round", async () => {
    const dragon = await monster("adult-red-dragon");
    expect(resourceSummary(resourceRows(dragon))).toBe("Fire Breath ready · Legendary resistance 3/3 · Legendary actions 3 a round");
    const spent = { ...sampleEncounter.combatants[0]!, resources: { ...dragon.resources, "usage:fire-breath": 0, "legendary-resistance": 1 } };
    expect(resourceSummary(resourceRows(dragon, spent))).toBe("Fire Breath recharging · Legendary resistance 1/3 · Legendary actions 3 a round");
    expect(resourceSummary(resourceRows(fighter()))).toBe("Second Wind 1/1 · Action Surge 1/1 · Rage 3/3");
  });
});

describe("Add: recipes, search and copies", () => {
  it("gives every recipe a record the editor opens, and sections to fill in that the record has", () => {
    const definition = fighter();
    expect(new Set(RECIPES.map((recipe) => recipe.id)).size).toBe(RECIPES.length);
    for (const recipe of RECIPES) {
      const prepared = recipe.prepare(definition);
      const record = prepared.record as { kind?: string; level?: number };
      const ids = sectionsFor({ ref: { list: prepared.list, id: "x" } as never, record: prepared.record, definition }).map((section) => section.id);
      for (const focus of prepared.focus ?? []) expect(ids, `${recipe.id} ${focus} (${record.kind ?? prepared.list})`).toContain(focus);
    }
  });

  it("finds recipes, library entries and monster abilities, by filter", async () => {
    const abilities = await loadSrdMonsterAbilities();
    const breath = searchAdd("breath", "all", abilities);
    expect(breath.recipes.map((recipe) => recipe.label)).toEqual(["Breath weapon"]);
    expect(breath.monster.every((entry) => /breath/i.test(`${entry.name} ${entry.text}`))).toBe(true);
    expect(breath.monsterMore).toBeGreaterThan(0);
    expect(searchAdd("fire breath", "monster", abilities).monster.some((entry) => entry.name === "Fire Breath" && entry.monster === "Adult Red Dragon")).toBe(true);
    const rage = searchAdd("rage", "all", abilities);
    const features = rage.library.filter((entry) => entry.kind === "feature");
    expect(features.filter((entry) => entry.edition === "2014").map((entry) => entry.name)).toEqual(["Rage", "Rage (Totem Warrior: Bear)", "Rage (Zealot)"]);
    expect(features.find((entry) => entry.edition === "2024" && entry.name === "Rage")?.from).toBe("Barbarian 1");
    // A search also finds reference-only spells: both editions' Mirage Arcane.
    expect(rage.library.filter((entry) => entry.name === "Mirage Arcane").map((entry) => `${entry.edition} ${entry.reference}`)).toEqual(["2014 true", "2024 true"]);
    // Filters narrow it; monster abilities wait for a query.
    expect(searchAdd("fire", "spells", abilities).library.every((entry) => entry.kind === "spell")).toBe(true);
    expect(searchAdd("pack", "features", abilities).monster.map((entry) => entry.kind)).toEqual(["trait"]);
    expect(searchAdd("", "all", abilities).monster).toEqual([]);
    expect(searchAdd("", "recipes", abilities).library).toEqual([]);
  });

  it("prepares a library spell as attach does: cast with the creature's ability, its source kept, fresh effect ids", () => {
    const prepared = prepareLibrary("spell", "srd:spell:hold-person", fighter())!;
    expect(prepared.list).toBe("spells");
    const spell = prepared.record as { action?: { dcFormula?: { ability?: string }; riders?: Array<{ id?: string }> }; source?: { slug?: string } };
    expect(spell.action?.dcFormula?.ability).toBe("spellcasting");
    expect(spell.source?.slug).toBe("srd:spell:hold-person");
    expect(spell.action?.riders?.every((rider) => rider.id?.startsWith("rider-"))).toBe(true);
  });

  it("copies a monster's ability with the pools it spends", async () => {
    const abilities = await loadSrdMonsterAbilities();
    // Listed once, under the first creature with it word for word.
    const resistance = abilities.find((entry) => entry.name === "Legendary Resistance (3/Day)")!;
    expect(resistance.others).toBeGreaterThan(10);
    expect(await prepareMonsterAbility(resistance)).toMatchObject({ list: "traits", pools: { "legendary-resistance": 3 } });
    const breath = abilities.find((entry) => entry.name === "Fire Breath" && entry.monster === "Adult Red Dragon")!;
    const prepared = (await prepareMonsterAbility(breath))!;
    // Its own recharge isn't brought as a pool: saving it gives it one of its own.
    expect(prepared.pools).toBeUndefined();
    expect(prepared.record).toMatchObject({ kind: "area-save", usage: { kind: "recharge" } });
  });
});

describe("the monster ability index", { timeout: 60000 }, () => {
  let abilities: readonly SrdMonsterAbilityEntry[] = [];
  beforeAll(async () => { abilities = await loadSrdMonsterAbilities(); });

  it("points every entry at a record its creature has, from a creature the library lists", async () => {
    const listed = new Set(SRD_MONSTER_INDEX.map((entry) => entry.id));
    expect(abilities.length).toBeGreaterThan(600);
    for (const entry of abilities) {
      expect(listed.has(entry.monsterId), entry.monsterId).toBe(true);
      const definition = await monster(entry.monsterId.replace("srd:monster:", ""));
      // A legendary action is found by its place.
      const ref: AbilityRef = entry.list === "legendary" ? { list: "legendary", index: Number(entry.id) } : { list: entry.list, id: entry.id };
      expect(findAbility(definition, ref), `${entry.monster} › ${entry.name}`).toBeDefined();
    }
  });

  it("leaves out what can't stand alone: multiattacks, summons, shapechanges and spellcasting", () => {
    expect(abilities.some((entry) => entry.kind === "multiattack" || entry.kind === "summon" || entry.kind === "transform")).toBe(false);
    expect(abilities.some((entry) => /^(Spellcasting|Innate Spellcasting|Condition Immunit)/.test(entry.name))).toBe(false);
  });
});

describe("a new ability's own pool", () => {
  const pristine = useEncounterStore.getState();
  beforeEach(() => useEncounterStore.setState(pristine, true));
  const store = () => useEncounterStore.getState();
  const def = () => store().encounter.definitions.find((d) => d.id === "def-fighter")!;

  it("is named for it when it's saved, so two new abilities never share one", () => {
    const recharge = actionLimit.set(blankSpecialAction(), { kind: "recharge", min: 5 });
    expect((recharge as { resourceCost?: { resourceId: string } }).resourceCost?.resourceId).toBe("usage:");
    const first = store().insertAbilityRecord("def-fighter", "actions", recharge)! as { id: string };
    const second = store().insertAbilityRecord("def-fighter", "actions", recharge)! as { id: string };
    const costOf = (id: string) => (def().actions.find((action) => action.id === id) as { resourceCost?: { resourceId: string } }).resourceCost?.resourceId;
    expect(costOf(first.id)).toBe(`usage:${first.id}`);
    expect(costOf(second.id)).toBe(`usage:${second.id}`);
    expect(def().resources).toMatchObject({ [`usage:${first.id}`]: 1, [`usage:${second.id}`]: 1 });
    expect(def().resources?.["usage:"]).toBeUndefined();
  });

  it("follows a duplicate, which gets a pool of its own beside its original", () => {
    const recharge = actionLimit.set(blankSpecialAction(), { kind: "recharge", min: 5 });
    const original = store().insertAbilityRecord("def-fighter", "actions", recharge)! as { id: string };
    const copy = duplicateOf(def(), { list: "actions", id: original.id })!;
    const added = store().insertAbilityRecord("def-fighter", copy.list, copy.record, { after: copy.after })! as { id: string };
    expect(def().actions.map((action) => action.id)).toEqual(["longsword", original.id, added.id]);
    const cost = (def().actions.find((action) => action.id === added.id) as { resourceCost?: { resourceId: string } }).resourceCost?.resourceId;
    expect(cost).toBe(`usage:${added.id}`);
    expect(getExecutableActions(def()).filter((action) => action.name === "New action (copy)")).toHaveLength(1);
  });
});
