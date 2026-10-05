import { describe, expect, it } from "vitest";
import {
  canAct,
  compileItemUses,
  createEngineState,
  maxOfDice,
  potionTimings,
  resolveHealingAction,
  runBatchSimulations,
  sampleEncounter,
  takeAutomatedTurn,
  withItemRules,
  withTableRule,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type EncounterSnapshot,
  type HealingActionDefinition,
  type ItemDefinition,
  type Point,
  type PotionUse,
  type RuleProfile
} from "@/engine";
import { findSrdItem } from "@/data/srd";
import { hotbarFor } from "@/lib/play/hotbar";

/**
 * The table's potion rules (ITEMS_PLAN.md §6, Phase 4): what drinking and giving a potion take, written into every potion
 * that follows the rule, and full healing for an action where a bonus action would do (D10, D11). The engine only ever
 * reads what a potion says.
 */

const POTION = findSrdItem("srd:item:potion-of-healing") as ItemDefinition;
const rules = (potionUse: PotionUse, potionActionHealsFull = false): Pick<RuleProfile, "potionUse" | "potionActionHealsFull"> => ({ potionUse, potionActionHealsFull });
const uses = (item: ItemDefinition) => compileItemUses(item).map((use) => [use.id, use.actionType, (use as HealingActionDefinition).healing[0]!.dice]);

describe("the potion rule, written into a potion", () => {
  it("says what drinking and giving take under each setting", () => {
    expect(potionTimings("action")).toEqual({ drink: "action", give: "action" });
    expect(potionTimings("bonus")).toEqual({ drink: "bonus", give: "bonus" });
    expect(potionTimings("drink-bonus")).toEqual({ drink: "bonus", give: "action" });
    expect(potionTimings(undefined)).toEqual({ drink: "action", give: "action" });
  });

  it("sets a potion's drink and give, and heals in full only where a bonus action would do", () => {
    const bonus = withTableRule(POTION, rules("bonus", true));
    expect(bonus.grantedActions![0]!.actionType).toBe("bonus");
    expect(bonus.give).toEqual({ actionType: "bonus" });
    expect(bonus.fullWithAction).toBe(true);
    const house = withTableRule(POTION, rules("drink-bonus", true));
    expect([house.grantedActions![0]!.actionType, house.give?.actionType, house.fullWithAction]).toEqual(["bonus", "action", true]);
    // The 2014 rule has no bonus action to trade.
    expect(withTableRule(POTION, rules("action", true))).toBe(POTION);
    expect(withTableRule(bonus, rules("bonus", false)).fullWithAction).toBeUndefined();
  });

  it("keeps a potion that can't be given ungiveable, and leaves a potion with its own timing, or anything else, alone", () => {
    const { give: _give, ...ungiven } = POTION;
    expect(withTableRule(ungiven, rules("bonus")).give).toBeUndefined();
    const own = { ...POTION, followsTableRule: false };
    expect(withTableRule(own, rules("bonus", true))).toBe(own);
    const flask: ItemDefinition = { ...POTION, type: "thrown" };
    expect(withTableRule(flask, rules("bonus", true))).toBe(flask);
  });

  it("is the same object once it says so: written twice, nothing changes", () => {
    const once = withTableRule(POTION, rules("bonus", true));
    expect(withTableRule(once, rules("bonus", true))).toBe(once);
  });

  it("goes into every potion in an encounter, leaving the rest of it be", () => {
    const encounter = structuredClone(sampleEncounter);
    expect(withItemRules(encounter)).toBe(encounter);
    encounter.definitions[0] = { ...encounter.definitions[0]!, items: [POTION] };
    encounter.rules = { ...encounter.rules, potionUse: "bonus" };
    const stamped = withItemRules(encounter);
    expect(stamped.definitions[0]!.items![0]!.grantedActions![0]!.actionType).toBe("bonus");
    expect(stamped.definitions.slice(1)).toEqual(encounter.definitions.slice(1));
    stamped.definitions.slice(1).forEach((definition, index) => expect(definition).toBe(encounter.definitions[index + 1]));
    expect(withItemRules(stamped)).toBe(stamped);
  });
});

describe("full healing for an action", () => {
  it("adds an action copy of each bonus-action heal under each rule", () => {
    // 2024: drink and give, each a rolled bonus action or the full amount for an action.
    expect(uses(withTableRule(POTION, rules("bonus", true)))).toEqual([
      ["drink", "bonus", "2d4+2"], ["drink:give", "bonus", "2d4+2"], ["drink:full", "action", "10"], ["drink:give:full", "action", "10"]
    ]);
    // The house rule: giving already takes an action, so only the drink has a full copy.
    expect(uses(withTableRule(POTION, rules("drink-bonus", true)))).toEqual([
      ["drink", "bonus", "2d4+2"], ["drink:give", "action", "2d4+2"], ["drink:full", "action", "10"]
    ]);
    expect(uses(withTableRule(POTION, rules("action", true)))).toEqual([["drink", "action", "2d4+2"], ["drink:give", "action", "2d4+2"]]);
    expect(uses(withTableRule(POTION, rules("bonus", false))).some(([id]) => String(id).endsWith(":full"))).toBe(false);
  });

  it("is each potion's maximum", () => {
    expect(["2d4+2", "4d4+4", "8d4+8", "10d4+20", "1d6-1", "10"].map(maxOfDice)).toEqual([10, 20, 40, 60, 5, 10]);
  });

  it("is nothing for a potion that heals a flat amount, or one that isn't a heal", () => {
    const flat = withTableRule({ ...POTION, grantedActions: [{ ...(POTION.grantedActions![0] as HealingActionDefinition), healing: [{ dice: "10" }] }] }, rules("bonus", true));
    expect(flat.fullWithAction).toBe(true);
    expect(compileItemUses(flat).map((use) => use.id)).toEqual(["drink", "drink:give"]);
    const heroism: ItemDefinition = {
      ...POTION, name: "Potion of Heroism", fullWithAction: true, grantedActions: [{
        kind: "buff", id: "drink", name: "Potion of Heroism", actionType: "bonus", range: 0, targeting: { target: "self" }, tempHp: [{ dice: "10" }],
        appliedCondition: { name: "custom", durationRounds: 600 }, resourceCost: { resourceId: "supply", amount: 1 }, automationSupport: "full"
      }]
    };
    expect(compileItemUses(heroism).some((use) => use.id.endsWith(":full"))).toBe(false);
  });

  it("heals exactly 10, spends one potion, takes the action, and says so", () => {
    const state = createEngineState(scene({ rule: "bonus", full: true, hp: 5, foes: [] }));
    resolveHealingAction(state, "kael", "kael", "drink:full");
    const kael = state.snapshot.combatants.find((combatant) => combatant.id === "kael")!;
    expect(kael.currentHp).toBe(15);
    expect(kael.resources?.["item:potions"]).toBe(2);
    expect(canAct(kael, "action")).toBe(false);
    expect(canAct(kael, "bonus")).toBe(true);
    const declared = state.log.find((entry) => entry.type === "ActionDeclared")!;
    expect(declared.message).toBe("Kael drinks a Potion of Healing with its action, for the full 10 HP");
    expect(declared.data?.item).toMatchObject({ name: "Potion of Healing", use: "drink", full: true });
  });

  it("is a variant on the hotbar's potion: the rolled bonus action first, then the full amount for an action", () => {
    const button = hotbarFor(scene({ rule: "bonus", full: true, hp: 5, foes: [] }), "kael").tabs.find((tab) => tab.id === "items")!.buttons[0]!;
    expect(button.variants.map((variant) => [variant.label, variant.slot])).toEqual([
      ["Drink (bonus action)", "bonus"], ["Give (bonus action)", "bonus"], ["Drink · full 10 (action)", "action"], ["Give · full 10 (action)", "action"]
    ]);
    expect(button.slot).toBe("bonus");
  });
});

/*
 * The AI's whole-turn choice (D10): attack and drink a rolled potion with the bonus action, or drink the full amount
 * with the action and use the bonus action for anything but another potion. Kael has 52 HP, AC 16 and a longsword
 * (and a longbow where it says). An ogre's greatclub lands 55% of the time for 13; an orc's greataxe half the time for
 * 9.5. A Potion of Healing heals 2d4 + 2 rolled, or 10 in full.
 */

const LONGSWORD: ActionDefinition = {
  kind: "attack", id: "longsword", name: "Longsword", actionType: "action", attackType: "melee", ability: "str", attackBonus: 5,
  range: 5, reach: 5, damage: [{ dice: "1d8+3", damageType: "slashing" }], automationSupport: "full"
};
const LONGBOW: ActionDefinition = {
  kind: "attack", id: "longbow", name: "Longbow", actionType: "action", attackType: "ranged", ability: "dex", attackBonus: 3,
  range: 150, longRange: 600, damage: [{ dice: "1d8+1", damageType: "piercing" }], automationSupport: "full"
};
const GREATAXE: ActionDefinition = {
  kind: "attack", id: "greataxe", name: "Greataxe", actionType: "action", attackType: "melee", ability: "str", attackBonus: 5,
  range: 5, reach: 5, damage: [{ dice: "1d12+3", damageType: "slashing" }], automationSupport: "full"
};
const GREATCLUB: ActionDefinition = {
  kind: "attack", id: "greatclub", name: "Greatclub", actionType: "action", attackType: "melee", ability: "str", attackBonus: 6,
  range: 5, reach: 5, damage: [{ dice: "2d8+4", damageType: "bludgeoning" }], automationSupport: "full"
};

function creature(id: string, name: string, overrides: Partial<CreatureDefinition> = {}): CreatureDefinition {
  return {
    id, name, size: "medium", type: "humanoid", armorClass: 16, maxHp: 52, speed: 30, proficiencyBonus: 2,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 16, cha: 10 }, actions: [LONGSWORD], ...overrides
  };
}

function token(id: string, displayName: string, definitionId: string, faction: "party" | "enemy", position: Point, hp: number, extra: Partial<CombatantState> = {}): CombatantState {
  return { id, definitionId, displayName, faction, position, currentHp: hp, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced", ...extra };
}

interface Setup {
  rule: PotionUse;
  full: boolean;
  hp: number;
  foes: Array<{ kind: "orc" | "ogre"; at: Point }>;
  kaelAt?: Point;
  kael?: Partial<CreatureDefinition>;
  /** Mira, down at 0 HP. */
  miraAt?: Point;
}

/** Kael with three Potions of Healing (the library's, attached), under the table's rules as the store writes them in. */
function scene(setup: Setup): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = "items-rules";
  encounter.map.walls = [];
  encounter.map.terrain = [];
  encounter.rules = { ...encounter.rules, potionUse: setup.rule, potionActionHealsFull: setup.full };
  const potions = { ...POTION, id: "potions", supply: { ...POTION.supply!, id: "item:potions", size: 3 },
    grantedActions: POTION.grantedActions!.map((use) => ({ ...use, resourceCost: { resourceId: "item:potions", amount: 1 } }) as ActionDefinition) };
  encounter.definitions = [
    creature("def-kael", "Kael", { ...setup.kael, items: [potions] }),
    creature("def-orc", "Orc", { armorClass: 13, maxHp: 15, actions: [GREATAXE] }),
    creature("def-ogre", "Ogre", { size: "medium", armorClass: 11, maxHp: 59, actions: [GREATCLUB] }),
    creature("def-mira", "Mira", { maxHp: 30 })
  ];
  encounter.combatants = [
    token("kael", "Kael", "def-kael", "party", setup.kaelAt ?? { x: 3, y: 3 }, setup.hp, { resources: { "item:potions": 3 } }),
    ...setup.foes.map((foe, index) => token(`${foe.kind}-${index + 1}`, `${foe.kind === "orc" ? "Orc" : "Ogre"} ${index + 1}`, `def-${foe.kind}`, "enemy", foe.at, foe.kind === "orc" ? 15 : 59)),
    ...(setup.miraAt
      ? [token("mira", "Mira", "def-mira", "party", setup.miraAt, 0, {
        state: "downed", deathSaves: { successes: 0, failures: 0, stable: false }, conditions: [{ id: "unconscious", name: "unconscious", startedRound: 1 }]
      })]
      : [])
  ];
  return withItemRules(encounter);
}

function kaelsTurn(setup: Setup) {
  const state = createEngineState(scene(setup));
  takeAutomatedTurn(state, state.snapshot.combatants.find((combatant) => combatant.id === "kael")!);
  const used = state.log
    .filter((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "kael")
    .map((entry) => ({ id: entry.data!.actionId as string, slot: entry.data!.actionType as string, target: entry.data!.targetId as string | undefined }));
  const kael = state.snapshot.combatants.find((combatant) => combatant.id === "kael")!;
  return {
    state,
    used: used.map((use) => use.id),
    slots: used.map((use) => `${use.id}:${use.slot}`),
    attacked: used.some((use) => use.id === "longsword" || use.id === "longbow"),
    potionsLeft: kael.resources?.["item:potions"],
    hp: kael.currentHp,
    mira: state.snapshot.combatants.find((combatant) => combatant.id === "mira")
  };
}

const NEXT_TO_KAEL: Point = { x: 4, y: 3 };

describe("the AI, with full healing for an action (the 2024 rule)", () => {
  it("4/52 against an ogre's 13-damage club: the full 10 clears it and the roll rarely does, so it drinks with the action and doesn't attack", () => {
    const turn = kaelsTurn({ rule: "bonus", full: true, hp: 4, foes: [{ kind: "ogre", at: NEXT_TO_KAEL }] });
    expect(turn.used).toEqual(["drink:full"]);
    expect(turn.hp).toBe(14);
    expect(turn.potionsLeft).toBe(2);
    const decision = turn.state.log.find((entry) => entry.type === "AiDecision" && entry.message === "Kael chose to drink a Potion of Healing")!;
    expect(decision.data?.reasons).toEqual(expect.arrayContaining(["the full 10, with an action instead of a bonus action"]));
  });

  it("8/52 against the same ogre: the rolled one keeps it up nearly as well, so it attacks and drinks that with the bonus action", () => {
    const turn = kaelsTurn({ rule: "bonus", full: true, hp: 8, foes: [{ kind: "ogre", at: NEXT_TO_KAEL }] });
    expect(turn.slots).toEqual(["longsword:action", "drink:bonus"]);
  });

  it("without the rule, 4/52 against the ogre attacks and drinks with the bonus action", () => {
    const turn = kaelsTurn({ rule: "bonus", full: false, hp: 4, foes: [{ kind: "ogre", at: NEXT_TO_KAEL }] });
    expect(turn.slots).toEqual(["longsword:action", "drink:bonus"]);
  });

  it("2/52 against the ogre: not even the full 10 clears its club, so it attacks and drinks with the bonus action", () => {
    const turn = kaelsTurn({ rule: "bonus", full: true, hp: 2, foes: [{ kind: "ogre", at: NEXT_TO_KAEL }] });
    expect(turn.slots).toEqual(["longsword:action", "drink:bonus"]);
  });

  it("9/52 with nothing able to reach it: drinks the full 10 with its idle action, and no second potion with the bonus action", () => {
    const turn = kaelsTurn({ rule: "bonus", full: true, hp: 9, foes: [{ kind: "orc", at: { x: 11, y: 3 } }], kaelAt: { x: 1, y: 3 } });
    expect(turn.used).toEqual(["drink:full"]);
    expect(turn.potionsLeft).toBe(2);
    expect(turn.hp).toBe(19);
  });

  it("an ally down next to an orc: the rolled potion would likely leave her to drop again, so it gives the full 10 with the action", () => {
    const turn = kaelsTurn({ rule: "bonus", full: true, hp: 52, foes: [{ kind: "orc", at: { x: 5, y: 3 } }], miraAt: NEXT_TO_KAEL });
    expect(turn.used[0]).toBe("drink:give:full");
    expect(turn.mira?.currentHp).toBe(10);
    expect(turn.potionsLeft).toBe(2);
  });

  it("an ally down next to the ogre: the full 10 wouldn't keep her up any better, so it gives the rolled one with the bonus action and attacks", () => {
    const turn = kaelsTurn({ rule: "bonus", full: true, hp: 52, foes: [{ kind: "ogre", at: { x: 5, y: 3 } }], miraAt: NEXT_TO_KAEL });
    expect(turn.slots.slice(0, 2)).toEqual(["drink:give:bonus", "longsword:action"]);
    expect(turn.mira?.state).toBe("active");
    const decision = turn.state.log.find((entry) => entry.type === "AiDecision" && entry.message === "Kael used a bonus action to give Mira a Potion of Healing")!;
    expect(decision.data?.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/^rolled, with the bonus action: \d+% to drop again/)]));
  });

  it("an ally down with nothing near her: gives the rolled one with the bonus action, and shoots with the action", () => {
    const turn = kaelsTurn({
      rule: "bonus", full: true, hp: 52, foes: [{ kind: "orc", at: { x: 15, y: 3 } }], miraAt: NEXT_TO_KAEL, kael: { actions: [LONGSWORD, LONGBOW] }
    });
    expect(turn.slots).toEqual(["drink:give:bonus", "longbow:action"]);
    expect(turn.potionsLeft).toBe(2);
  });
});

describe("the AI under the other potion rules", () => {
  it("the house rule: 4/52 against the ogre drinks in full with the action too", () => {
    const turn = kaelsTurn({ rule: "drink-bonus", full: true, hp: 4, foes: [{ kind: "ogre", at: NEXT_TO_KAEL }] });
    expect(turn.used).toEqual(["drink:full"]);
  });

  it("the house rule: an ally down gets a rolled potion for the action, there being no bonus action to give one with", () => {
    const turn = kaelsTurn({ rule: "drink-bonus", full: true, hp: 52, foes: [{ kind: "orc", at: { x: 5, y: 3 } }], miraAt: NEXT_TO_KAEL });
    expect(turn.slots[0]).toBe("drink:give:action");
  });

  it("a batch says how many potions were used for the full amount", () => {
    const summary = runBatchSimulations(scene({ rule: "bonus", full: true, hp: 4, foes: [{ kind: "ogre", at: NEXT_TO_KAEL }] }), 20, { seedPrefix: "items-full" });
    const potion = summary.items!.used.find((item) => item.name === "Potion of Healing")!;
    expect(potion.fullPerFight).toBeGreaterThan(0);
    expect(potion.fullPerFight!).toBeLessThanOrEqual(potion.perFight);
    const rolled = runBatchSimulations(scene({ rule: "bonus", full: false, hp: 4, foes: [{ kind: "ogre", at: NEXT_TO_KAEL }] }), 20, { seedPrefix: "items-full" });
    expect(rolled.items!.used.find((item) => item.name === "Potion of Healing")!.fullPerFight).toBeUndefined();
  });

  it("the 2014 rule: the full-healing rule changes nothing, every potion taking an action", () => {
    const turn = kaelsTurn({ rule: "action", full: true, hp: 8, foes: [{ kind: "orc", at: NEXT_TO_KAEL }, { kind: "orc", at: { x: 3, y: 4 } }] });
    expect(turn.slots).toEqual(["drink:action"]);
  });
});
