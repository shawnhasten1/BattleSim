import { beforeEach, describe, expect, it } from "vitest";
import {
  compileItemUses,
  createEngineState,
  damageAdjustmentsFor,
  featureSources,
  getExecutableActions,
  grownDice,
  isPrepDrink,
  resolveAttack,
  resolveBuffAction,
  sampleEncounter,
  takeAutomatedTurn,
  withItemPool,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type EncounterSnapshot,
  type ItemDefinition,
  type Point
} from "@/engine";
import { SRD_ITEMS, SRD_SPELL_SCROLLS, findSrdItem, scrollNumbers } from "@/data/srd";
import { RECIPES, prepareLibrary, searchAdd } from "@/lib/ability-editor/add";
import { checkRecordJson, recordJson } from "@/lib/ability-editor/json";
import { abilityWarnings } from "@/lib/ability-editor/validate";
import { hotbarFor } from "@/lib/play/hotbar";
import { itemStatblock } from "@/lib/statblock";
import { useEncounterStore } from "@/store/encounter-store";

/** ITEMS_PLAN.md §7, Phase 5: the item library, each item checked, and what the new kinds of item do in a fight. */

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((definition) => definition.id === "def-fighter")!;

describe("the library audit", () => {
  it("every item's JSON checks out as a new item, as the editor would save it", () => {
    for (const item of SRD_ITEMS) {
      const check = checkRecordJson(recordJson(item as ItemDefinition), item as ItemDefinition, "items", fighter());
      expect(check.ok, `${item.name}: ${check.ok ? "" : check.problems.join("; ")}`).toBe(true);
    }
  });

  it("every item attaches cleanly: its pool seeded, nothing to warn about, and compiles at the support it claims", () => {
    for (const source of SRD_ITEMS) {
      useEncounterStore.setState(pristine, true);
      const id = store().attachSrdItem("def-fighter", source.id)!;
      const item = fighter().items!.find((candidate) => candidate.id === id)!;
      expect(item, source.name).toBeDefined();
      if (item.supply) {
        expect(item.supply.id, source.name).toBe(`item:${id}`);
        expect(fighter().resources?.[item.supply.id], source.name).toBe(item.supply.size);
      }
      // Only what it says of itself: reference only, or partly simulated.
      const expected = source.automationSupport === "manual-only" ? ["reference-only"] : [];
      const warnings = abilityWarnings(fighter(), { list: "items", id }, item).map((warning) => warning.id).filter((warning) => warning !== "partly-simulated");
      expect(warnings, source.name).toEqual(expected);
      const uses = getExecutableActions(fighter()).filter((action) => action.item?.id === id);
      const carried = featureSources(fighter()).some((feature) => feature.name === item.name && (feature.effects?.length ?? 0) > 0);
      if (source.automationSupport === "manual-only") {
        expect(uses, source.name).toEqual([]);
        expect(carried, source.name).toBe(false);
      } else if (!item.grantedActions?.length) {
        // A ring or a cloak works while it's carried.
        expect(carried, source.name).toBe(true);
      } else {
        expect(uses.length, source.name).toBeGreaterThan(0);
        const supports = new Set(uses.map((use) => use.automationSupport));
        expect([...supports].every((support) => support === "full" || support === "partial"), source.name).toBe(true);
        expect(supports.has(source.automationSupport as "full" | "partial"), source.name).toBe(true);
        // Every use spends the item's own pool.
        for (const use of uses) expect((use as { resourceCost?: { resourceId: string } }).resourceCost?.resourceId, `${source.name}: ${use.id}`).toBe(item.supply?.id);
      }
    }
  });

  it("every Potion of Healing heals what its text says", () => {
    for (const item of SRD_ITEMS.filter((candidate) => /^Potion of .*Healing$/.test(candidate.name))) {
      const drink = item.grantedActions![0] as Extract<ActionDefinition, { kind: "healing" }>;
      expect(item.description, item.name).toContain(`regain ${drink.healing[0]!.dice.replace("+", " + ")} hit points`);
    }
  });

  it("names every item once", () => {
    const names = SRD_ITEMS.map((item) => item.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("a wand's spell for more charges", () => {
  const uses = (id: string) => compileItemUses(withItemPool(structuredClone(findSrdItem(id)!) as ItemDefinition, "wand"));

  it("grows dice the way a higher slot does", () => {
    expect(grownDice("8d6", "1d6", 2)).toBe("10d6");
    expect(grownDice("1d4+1", "1d4", 1)).toBe("2d4+1");
    expect(grownDice("10", "1d6", 1)).toBe("1d6+10");
  });

  it("a Wand of Fireballs: one charge is the 3rd-level Fireball at DC 15, each more a level higher, up to all 7", () => {
    const fireballs = uses("srd:item:wand-of-fireballs");
    expect(fireballs.map((use) => [use.id, (use as { resourceCost: { amount: number } }).resourceCost.amount, (use as { spellLevel: number }).spellLevel, (use as { damage: Array<{ dice: string }> }).damage[0]!.dice]))
      .toEqual([
        ["fireball", 1, 3, "8d6"], ["fireball:charges-2", 2, 4, "9d6"], ["fireball:charges-3", 3, 5, "10d6"], ["fireball:charges-4", 4, 6, "11d6"],
        ["fireball:charges-5", 5, 7, "12d6"], ["fireball:charges-6", 6, 8, "13d6"], ["fireball:charges-7", 7, 9, "14d6"]
      ]);
    expect(fireballs.every((use) => (use as { dc?: number }).dc === 15 && !(use as { dcFormula?: unknown }).dcFormula)).toBe(true);
  });

  it("a Wand of Magic Missiles fires a dart more for each extra charge", () => {
    expect(uses("srd:item:wand-of-magic-missiles").map((use) => (use as { beamCount: number }).beamCount)).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it("a Wand of Web casts Web for one charge only, at DC 15", () => {
    const web = uses("srd:item:wand-of-web");
    expect(web.map((use) => use.id)).toEqual(["web"]);
    expect(web[0]).toMatchObject({ dc: 15, spellLevel: 2, concentration: true });
  });

  it("a Necklace of Fireballs throws one bead or several, a level higher for each bead beyond the first", () => {
    const beads = uses("srd:item:necklace-of-fireballs");
    expect(beads.map((use) => [(use as { resourceCost: { amount: number } }).resourceCost.amount, (use as { spellLevel: number }).spellLevel])).toEqual([[1, 3], [2, 4], [3, 5], [4, 6], [5, 7], [6, 8]]);
  });

  it("says so on the sheet, and folds into one button on the hotbar", () => {
    const wand = withItemPool(structuredClone(findSrdItem("srd:item:wand-of-fireballs")!) as ItemDefinition, "wand");
    const text = itemStatblock(wand, carrier([wand])).text;
    expect(text).toContain("Each extra charge spent at once casts it a level higher, for 1d6 more damage, up to 7 (9th level).");
    const button = hotbarFor(scene({ items: [wand] }), "kael").tabs.find((tab) => tab.id === "items")!.buttons[0]!;
    expect(button.name).toBe("Fireball (Wand of Fireballs)");
    expect(button.variants.map((variant) => variant.label)).toEqual([
      "1 charge · 3rd", "2 charges · 4th", "3 charges · 5th", "4 charges · 6th", "5 charges · 7th", "6 charges · 8th", "7 charges · 9th"
    ]);
  });

  it("the AI blasts a pack of goblins with it, and spends no more charges than it has", () => {
    const wand = withItemPool(structuredClone(findSrdItem("srd:item:wand-of-fireballs")!) as ItemDefinition, "wand");
    const state = createEngineState(scene({
      items: [wand], resources: { "item:wand": 3 }, kaelAt: { x: 1, y: 1 },
      foes: [{ x: 8, y: 5 }, { x: 9, y: 5 }, { x: 8, y: 6 }, { x: 9, y: 6 }]
    }));
    takeAutomatedTurn(state, state.snapshot.combatants[0]!);
    const used = state.log.find((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "kael");
    expect(String(used?.data?.actionId)).toMatch(/^fireball(:charges-[23])?$/);
    expect(state.snapshot.combatants[0]!.resources?.["item:wand"]).toBeGreaterThanOrEqual(0);
  });
});

describe("spell scrolls", () => {
  it("cast at the scroll's own numbers, by the spell's level", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => Object.values(scrollNumbers(level)).join("/")))
      .toEqual(["13/5", "13/5", "13/5", "15/7", "15/7", "17/9", "17/9", "18/10", "18/10", "19/11"]);
    const fireball = findSrdItem("srd:item:scroll-of-fireball")!;
    expect(fireball).toMatchObject({ name: "Scroll of Fireball", type: "scroll", supply: { size: 1, unit: "count" } });
    expect(fireball.grantedActions![0]).toMatchObject({ kind: "area-save", dc: 15, spellLevel: 3, resourceCost: { resourceId: "supply", amount: 1 } });
    expect((fireball.grantedActions![0] as { dcFormula?: unknown }).dcFormula).toBeUndefined();
    const fireBolt = findSrdItem("srd:item:scroll-of-fire-bolt")!.grantedActions![0]!;
    expect(fireBolt).toMatchObject({ kind: "attack", attackBonus: 5 });
    expect((fireBolt as { attackBonusFormula?: unknown }).attackBonusFormula).toBeUndefined();
    expect(findSrdItem("srd:item:scroll-of-bless")!.grantedActions![0]).toMatchObject({ kind: "buff", concentration: true, spellLevel: 1 });
  });

  it("are found by asking for a scroll, never listed otherwise; the recipe asks for one", () => {
    expect(searchAdd("fire", "items", undefined).library.some((entry) => entry.name.startsWith("Scroll of"))).toBe(false);
    expect(searchAdd("", "items", undefined).library.some((entry) => entry.name.startsWith("Scroll of"))).toBe(false);
    const found = searchAdd("scroll fire", "items", undefined).library.map((entry) => entry.name);
    expect(found).toEqual(expect.arrayContaining(["Scroll of Fireball", "Scroll of Fire Bolt"]));
    expect(searchAdd("scroll", "items", undefined).library.length).toBe(SRD_SPELL_SCROLLS.length);
    expect(RECIPES.find((recipe) => recipe.label === "Spell scroll")?.search).toBe("scroll ");
  });

  it("can be made of the creature's own spell, and attached", () => {
    const lance = { ...structuredClone(findSrdItem("srd:item:scroll-of-fire-bolt")!.grantedActions![0]!), id: "lance-action", name: "Frost Lance" } as ActionDefinition;
    const spell = { id: "spell-frost-lance", name: "Frost Lance", level: 2, school: "evocation", castingTime: "action", range: 60, automationSupport: "full", action: lance } as const;
    useEncounterStore.setState({ encounter: { ...store().encounter, definitions: store().encounter.definitions.map((definition) => (definition.id === "def-fighter" ? { ...definition, spells: [spell as never] } : definition)) } });
    const entry = searchAdd("scroll frost", "items", undefined, fighter()).library.find((candidate) => candidate.name === "Scroll of Frost Lance")!;
    expect(entry.id).toBe("own-scroll:spell-frost-lance");
    expect(prepareLibrary("item", entry.id, fighter())!.record).toMatchObject({ name: "Scroll of Frost Lance", source: { documentName: "Spell scroll" } });
    const id = store().attachSrdItem("def-fighter", entry.id)!;
    const item = fighter().items!.find((candidate) => candidate.id === id)!;
    expect(item.grantedActions![0]).toMatchObject({ kind: "attack", attackBonus: 5, spellLevel: 2, resourceCost: { resourceId: `item:${id}`, amount: 1 } });
  });

  it("every scroll in the library attaches cleanly and compiles", () => {
    for (const source of SRD_SPELL_SCROLLS) {
      useEncounterStore.setState(pristine, true);
      const id = store().attachSrdItem("def-fighter", source.id)!;
      const item = fighter().items!.find((candidate) => candidate.id === id)!;
      // The fighter casts no spells, so reading a leveled one takes a check the simulator doesn't roll: said, as it should be.
      const warnings = abilityWarnings(fighter(), { list: "items", id }, item).map((warning) => warning.id).filter((warning) => warning !== "partly-simulated" && warning !== "scroll-above-level");
      expect(warnings, source.name).toEqual([]);
      expect(getExecutableActions(fighter()).filter((action) => action.item?.id === id), source.name).toHaveLength(1);
    }
  });

  it("the AI reads a Scroll of Fireball at a pack of goblins", () => {
    const scroll = withItemPool(structuredClone(findSrdItem("srd:item:scroll-of-fireball")!) as ItemDefinition, "scroll");
    const state = createEngineState(scene({ items: [scroll], resources: { "item:scroll": 1 }, kaelAt: { x: 1, y: 1 }, foes: [{ x: 8, y: 5 }, { x: 9, y: 5 }, { x: 8, y: 6 }, { x: 9, y: 6 }] }));
    takeAutomatedTurn(state, state.snapshot.combatants[0]!);
    expect(state.log.some((entry) => entry.type === "ActionDeclared" && /^Kael reads a Scroll of Fireball/.test(entry.message))).toBe(true);
    expect(state.snapshot.combatants[0]!.resources?.["item:scroll"]).toBe(0);
  });
});

describe("the other new items in a fight", () => {
  it("lists the long-lasting potions as drinks before the fight, the 1-minute ones not", () => {
    const drink = (id: string) => compileItemUses(findSrdItem(id) as ItemDefinition)[0]!;
    expect(isPrepDrink(drink("srd:item:potion-of-heroism"))).toBe(true);
    expect(isPrepDrink(drink("srd:item:potion-of-resistance"))).toBe(true);
    expect(isPrepDrink(drink("srd:item:potion-of-invulnerability"))).toBe(false);
    expect(isPrepDrink(drink("srd:item:potion-of-speed"))).toBe(false);
  });

  it("a Potion of Heroism gives 10 temporary hit points and Bless's +2", () => {
    const potion = withItemPool(structuredClone(findSrdItem("srd:item:potion-of-heroism")!) as ItemDefinition, "heroism");
    const state = createEngineState(scene({ items: [potion], resources: { "item:heroism": 1 } }));
    resolveBuffAction(state, "kael", "drink", ["kael"]);
    const kael = state.snapshot.combatants[0]!;
    expect(kael.tempHp).toBe(10);
    expect(kael.conditions?.find((condition) => condition.sourceName === "Potion of Heroism")?.modifiers).toMatchObject({ attackRoll: 2 });
    expect(kael.resources?.["item:heroism"]).toBe(0);
  });

  it("a Potion of Invulnerability resists every kind of damage", () => {
    const potion = withItemPool(structuredClone(findSrdItem("srd:item:potion-of-invulnerability")!) as ItemDefinition, "invulnerability");
    const state = createEngineState(scene({ items: [potion], resources: { "item:invulnerability": 1 } }));
    resolveBuffAction(state, "kael", "drink", ["kael"]);
    const kael = state.snapshot.combatants[0]!;
    const resisted = damageAdjustmentsFor(state.snapshot.definitions[0]!, kael).filter((adjustment) => adjustment.type === "resistance");
    expect(resisted.map((adjustment) => adjustment.damageType)).toHaveLength(13);
  });

  it("a Ring of Protection adds 1 to AC while attuned, and nothing while not", () => {
    const ring = structuredClone(findSrdItem("srd:item:ring-of-protection")!) as ItemDefinition;
    const acAgainst = (item: ItemDefinition) => {
      const state = createEngineState(scene({ items: [item], foes: [{ x: 4, y: 3 }] }));
      resolveAttack(state, "goblin-1", "kael", "scimitar");
      return state.log.find((entry) => entry.type === "AttackRolled")!.data!.targetAc;
    };
    expect(acAgainst(ring)).toBe(17);
    expect(acAgainst({ ...ring, attunement: { attuned: false } })).toBe(16);
  });

  it("a flask of holy water burns a zombie, and only splashes a goblin", () => {
    const flask = withItemPool(structuredClone(findSrdItem("srd:item:holy-water")!) as ItemDefinition, "holy");
    const thrown = (type: CreatureDefinition["type"]) => {
      const state = createEngineState(scene({ items: [flask], resources: { "item:holy": 1 }, foes: [{ x: 5, y: 3 }], foeType: type, foeAc: 1 }));
      resolveAttack(state, "kael", "goblin-1", "throw");
      const roll = state.log.find((entry) => entry.type === "AttackRolled")!;
      expect(roll.data?.hit).toBe(true);
      return { hp: state.snapshot.combatants.find((combatant) => combatant.id === "goblin-1")!.currentHp, log: state.log.map((entry) => entry.type) };
    };
    expect(itemStatblock(flask, carrier([flask])).short).toContain("+7 (2d6) radiant (fiend or undead only)");
    expect(thrown("undead").hp).toBeLessThan(30);
    const goblin = thrown("humanoid");
    expect(goblin.hp).toBe(30);
    expect(goblin.log).toContain("RiderSkipped");
  });
});

/* ── a small scene: Kael and what he carries, against goblins ──────────────── */

const SCIMITAR: ActionDefinition = {
  kind: "attack", id: "scimitar", name: "Scimitar", actionType: "action", attackType: "melee", ability: "dex", attackBonus: 4,
  range: 5, reach: 5, damage: [{ dice: "1d6+2", damageType: "slashing" }], automationSupport: "full"
};

function carrier(items: ItemDefinition[]): CreatureDefinition {
  return {
    id: "def-kael", name: "Kael", size: "medium", type: "humanoid", armorClass: 16, maxHp: 52, speed: 30, proficiencyBonus: 3,
    abilities: { str: 16, dex: 14, con: 14, int: 16, wis: 12, cha: 10 }, actions: [], items
  };
}

function scene(setup: { items: ItemDefinition[]; resources?: Record<string, number>; foes?: Point[]; kaelAt?: Point; foeType?: CreatureDefinition["type"]; foeAc?: number }): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = "items-library";
  encounter.map.walls = [];
  encounter.map.terrain = [];
  encounter.definitions = [
    carrier(setup.items),
    { ...carrier([]), id: "def-goblin", name: "Goblin", type: setup.foeType ?? "humanoid", armorClass: setup.foeAc ?? 13, maxHp: 30, actions: [SCIMITAR], items: undefined }
  ];
  const token = (id: string, name: string, definitionId: string, faction: "party" | "enemy", position: Point, hp: number, extra: Partial<CombatantState> = {}): CombatantState => ({
    id, definitionId, displayName: name, faction, position, currentHp: hp, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced", ...extra
  });
  encounter.combatants = [
    token("kael", "Kael", "def-kael", "party", setup.kaelAt ?? { x: 3, y: 3 }, 52, { resources: setup.resources ?? {} }),
    ...(setup.foes ?? []).map((at, index) => token(`goblin-${index + 1}`, `Goblin ${index + 1}`, "def-goblin", "enemy", at, 30))
  ];
  return encounter;
}
