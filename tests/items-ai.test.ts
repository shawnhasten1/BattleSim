import { describe, expect, it } from "vitest";
import {
  createEngineState,
  dangerBeforeNextTurn,
  sampleEncounter,
  takeAutomatedTurn,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type EncounterSnapshot,
  type ItemDefinition,
  type Point,
  type ResourceStance
} from "@/engine";

/**
 * When the AI drinks and gives potions (ITEMS_PLAN.md §3, D4): the plan's worked examples, each a test. Kael has 52 HP,
 * AC 16 and a longsword; an orc's greataxe is expected to deal him 4.75 a turn (9.5 on a hit, half the time).
 */

const LONGSWORD: ActionDefinition = {
  kind: "attack", id: "longsword", name: "Longsword", actionType: "action", attackType: "melee", ability: "str", attackBonus: 5,
  range: 5, reach: 5, damage: [{ dice: "1d8+3", damageType: "slashing" }], automationSupport: "full"
};
const GREATAXE: ActionDefinition = {
  kind: "attack", id: "greataxe", name: "Greataxe", actionType: "action", attackType: "melee", ability: "str", attackBonus: 5,
  range: 5, reach: 5, damage: [{ dice: "1d12+3", damageType: "slashing" }], automationSupport: "full"
};
const HEALING_WORD: ActionDefinition = {
  kind: "healing", id: "healing-word", name: "Healing Word", actionType: "bonus", range: 60, healing: [{ dice: "1d4", abilityModifier: "wis" }],
  targeting: { target: "single" }, spellLevel: 1, resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full"
};

function potions(slot: "action" | "bonus"): ItemDefinition {
  return {
    id: "potions", name: "Potion of Healing", type: "potion", supply: { id: "item:potions", size: 3, unit: "count" },
    give: { actionType: slot },
    grantedActions: [{
      kind: "healing", id: "drink", name: "Potion of Healing", actionType: slot, range: 0, healing: [{ dice: "2d4+2" }],
      targeting: { target: "self" }, resourceCost: { resourceId: "item:potions", amount: 1 }, automationSupport: "full"
    }],
    automationSupport: "full"
  };
}

const ACID: ItemDefinition = {
  id: "acid", name: "Vial of Acid", type: "thrown", supply: { id: "item:acid", size: 2, unit: "count" },
  grantedActions: [{
    kind: "attack", id: "acid-throw", name: "Vial of Acid", actionType: "action", attackType: "ranged", ability: "dex", attackBonus: 3,
    range: 20, longRange: 60, damage: [{ dice: "2d6", damageType: "acid" }], resourceCost: { resourceId: "item:acid", amount: 1 }, automationSupport: "full"
  }],
  automationSupport: "full"
};

function creature(id: string, name: string, overrides: Partial<CreatureDefinition> = {}): CreatureDefinition {
  return {
    id, name, size: "medium", type: "humanoid", armorClass: 16, maxHp: 52, speed: 30, proficiencyBonus: 2,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 16, cha: 10 }, actions: [LONGSWORD], ...overrides
  };
}

function token(id: string, displayName: string, definitionId: string, faction: "party" | "enemy", position: Point, hp: number, extra: Partial<CombatantState> = {}): CombatantState {
  return {
    id, definitionId, displayName, faction, position, currentHp: hp, tempHp: 0, state: "active",
    tacticsProfile: "basic-melee", resourceStance: "balanced", ...extra
  };
}

interface Setup {
  hp: number;
  /** Kael's potions take this slot; none without it. */
  potions?: "action" | "bonus";
  left?: number;
  orcs: Point[];
  stance?: ResourceStance;
  kael?: Partial<CreatureDefinition>;
  kaelAt?: Point;
  /** Mira, Kael's ally: down (0 HP) unless `hp` says otherwise. */
  mira?: { at: Point; hp?: number };
  /** Kael fights for the enemy and the orcs for the party (a monster with a potion). */
  swapSides?: boolean;
  resources?: Record<string, number>;
}

function scene(setup: Setup): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = "items-ai";
  encounter.map.walls = [];
  encounter.map.terrain = [];
  const items = [...(setup.potions ? [potions(setup.potions)] : []), ...(setup.kael?.items ?? [])];
  encounter.definitions = [
    creature("def-kael", "Kael", { ...setup.kael, items: items.length ? items : undefined }),
    creature("def-orc", "Orc", { armorClass: 13, maxHp: 15, actions: [GREATAXE] }),
    creature("def-mira", "Mira", { maxHp: 30 })
  ];
  const kaelSide = setup.swapSides ? "enemy" : "party";
  const orcSide = setup.swapSides ? "party" : "enemy";
  const resources = { ...(setup.potions ? { "item:potions": setup.left ?? 3 } : {}), ...setup.resources };
  encounter.combatants = [
    token("kael", "Kael", "def-kael", kaelSide, setup.kaelAt ?? { x: 3, y: 3 }, setup.hp, { resourceStance: setup.stance ?? "balanced", resources }),
    ...setup.orcs.map((at, index) => token(`orc-${index + 1}`, `Orc ${index + 1}`, "def-orc", orcSide, at, 15)),
    ...(setup.mira
      ? [token("mira", "Mira", "def-mira", kaelSide, setup.mira.at, setup.mira.hp ?? 0, (setup.mira.hp ?? 0) > 0 ? {} : {
        state: "downed",
        deathSaves: { successes: 0, failures: 0, stable: false },
        conditions: [{ id: "unconscious", name: "unconscious", startedRound: 1 }]
      })]
      : [])
  ];
  return encounter;
}

function kaelsTurn(encounter: EncounterSnapshot) {
  const state = createEngineState(encounter);
  takeAutomatedTurn(state, state.snapshot.combatants.find((combatant) => combatant.id === "kael")!);
  const used = state.log
    .filter((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "kael")
    .map((entry) => ({ actionId: entry.data!.actionId as string, actionType: entry.data!.actionType as string, targetId: entry.data!.targetId as string | undefined }));
  const kael = state.snapshot.combatants.find((combatant) => combatant.id === "kael")!;
  return {
    state,
    used,
    drank: used.find((use) => use.actionId === "drink"),
    attacked: used.some((use) => use.actionId === "longsword"),
    potionsLeft: kael.resources?.["item:potions"],
    mira: state.snapshot.combatants.find((combatant) => combatant.id === "mira")
  };
}

const ADJACENT_ONE: Point[] = [{ x: 4, y: 3 }];
const ADJACENT_TWO: Point[] = [{ x: 4, y: 3 }, { x: 3, y: 4 }];

describe("the danger before its next turn", () => {
  it("adds up each hostile that can reach it: two adjacent orcs are 2 × 4.75", () => {
    const encounter = scene({ hp: 52, orcs: ADJACENT_TWO });
    const kael = encounter.combatants.find((combatant) => combatant.id === "kael")!;
    expect(dangerBeforeNextTurn(encounter, kael).total).toBeCloseTo(9.5, 5);
    expect(dangerBeforeNextTurn(encounter, kael).threats).toBe(2);
  });

  it("doesn't count an orc too far away to reach it, or one that can't act", () => {
    const far = scene({ hp: 52, orcs: [{ x: 11, y: 3 }], kaelAt: { x: 1, y: 3 } });
    expect(dangerBeforeNextTurn(far, far.combatants[0]!).total).toBe(0);
    const stunned = scene({ hp: 52, orcs: ADJACENT_ONE });
    stunned.combatants.find((combatant) => combatant.id === "orc-1")!.conditions = [{ id: "stunned", name: "stunned", startedRound: 1 }];
    expect(dangerBeforeNextTurn(stunned, stunned.combatants[0]!).total).toBe(0);
  });
});

describe("drinking (the plan's worked examples)", () => {
  it("40/52 with one orc on it: attacks, and doesn't drink, whatever a potion takes", () => {
    for (const slot of ["action", "bonus"] as const) {
      const turn = kaelsTurn(scene({ hp: 40, potions: slot, orcs: ADJACENT_ONE }));
      expect(turn.drank).toBeUndefined();
      expect(turn.attacked).toBe(true);
    }
  });

  it("8/52 with two orcs on it (≈9.5 coming): drinks rather than attack when a potion takes the action", () => {
    const turn = kaelsTurn(scene({ hp: 8, potions: "action", orcs: ADJACENT_TWO }));
    expect(turn.drank?.actionType).toBe("action");
    expect(turn.attacked).toBe(false);
    expect(turn.potionsLeft).toBe(2);
    const decision = turn.state.log.find((entry) => entry.type === "AiDecision" && entry.message === "Kael chose to drink a Potion of Healing")!;
    expect(decision.data?.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/damage likely before its next turn \(2 in reach\)/)]));
  });

  it("the same with a bonus-action potion: drinks and attacks", () => {
    const turn = kaelsTurn(scene({ hp: 8, potions: "bonus", orcs: ADJACENT_TWO }));
    expect(turn.drank?.actionType).toBe("bonus");
    expect(turn.attacked).toBe(true);
  });

  it("20/52, bloodied, one orc on it: attacks with its action; a bonus action with nothing better drinks", () => {
    const action = kaelsTurn(scene({ hp: 20, potions: "action", orcs: ADJACENT_ONE }));
    expect(action.drank).toBeUndefined();
    expect(action.attacked).toBe(true);
    const bonus = kaelsTurn(scene({ hp: 20, potions: "bonus", orcs: ADJACENT_ONE }));
    expect(bonus.drank?.actionType).toBe("bonus");
    expect(bonus.attacked).toBe(true);
  });

  it("9/52 with nothing able to reach it: drinks, since there's nothing better to do with the slot", () => {
    for (const slot of ["action", "bonus"] as const) {
      const turn = kaelsTurn(scene({ hp: 9, potions: slot, orcs: [{ x: 11, y: 3 }], kaelAt: { x: 1, y: 3 } }));
      expect(turn.drank?.actionType).toBe(slot);
    }
  });

  it("conservative, bloodied but not about to drop: keeps its potions", () => {
    for (const slot of ["action", "bonus"] as const) {
      const turn = kaelsTurn(scene({ hp: 20, potions: slot, orcs: ADJACENT_ONE, stance: "conservative" }));
      expect(turn.drank).toBeUndefined();
      expect(turn.attacked).toBe(true);
    }
  });

  it("conservative still drinks when the potion would keep it up", () => {
    const turn = kaelsTurn(scene({ hp: 8, potions: "action", orcs: ADJACENT_TWO, stance: "conservative" }));
    expect(turn.drank).toBeDefined();
  });

  it("liberal drinks whenever the heal won't be wasted and the slot has nothing better", () => {
    const turn = kaelsTurn(scene({ hp: 40, potions: "bonus", orcs: ADJACENT_ONE, stance: "liberal" }));
    expect(turn.drank?.actionType).toBe("bonus");
    expect(turn.attacked).toBe(true);
  });

  it("with no potions left, it never tries", () => {
    const turn = kaelsTurn(scene({ hp: 8, potions: "action", left: 0, orcs: ADJACENT_TWO }));
    expect(turn.drank).toBeUndefined();
    expect(turn.attacked).toBe(true);
  });

  it("a monster with a potion drinks it too when it's about to drop", () => {
    const turn = kaelsTurn(scene({ hp: 8, potions: "action", orcs: ADJACENT_TWO, swapSides: true }));
    expect(turn.drank).toBeDefined();
  });
});

describe("giving", () => {
  it("at full HP, with an ally down 15 ft away, it moves and gives it a potion with its action", () => {
    const turn = kaelsTurn(scene({ hp: 52, potions: "action", orcs: [{ x: 5, y: 1 }], kaelAt: { x: 1, y: 1 }, mira: { at: { x: 4, y: 1 } } }));
    expect(turn.used.find((use) => use.actionId === "drink:give")?.targetId).toBe("mira");
    expect(turn.mira?.state).toBe("active");
    expect(turn.mira?.currentHp).toBeGreaterThan(0);
    expect(turn.potionsLeft).toBe(2);
  });

  it("with bonus-action potions it gives one and still attacks", () => {
    const turn = kaelsTurn(scene({ hp: 52, potions: "bonus", orcs: [{ x: 5, y: 1 }], kaelAt: { x: 1, y: 1 }, mira: { at: { x: 4, y: 1 } } }));
    expect(turn.used.find((use) => use.actionId === "drink:give")?.actionType).toBe("bonus");
    expect(turn.mira?.state).toBe("active");
    expect(turn.attacked).toBe(true);
  });

  it("never to a conscious ally, who can drink its own", () => {
    const turn = kaelsTurn(scene({ hp: 52, potions: "action", orcs: [{ x: 4, y: 3 }], mira: { at: { x: 3, y: 2 }, hp: 5 } }));
    expect(turn.used.some((use) => use.actionId === "drink:give")).toBe(false);
    expect(turn.attacked).toBe(true);
  });

  it("a cleric with Healing Word in range casts it rather than walking over to give a potion", () => {
    for (const slot of ["action", "bonus"] as const) {
      const turn = kaelsTurn(scene({
        hp: 52, potions: slot, orcs: [{ x: 2, y: 1 }], kaelAt: { x: 1, y: 1 }, mira: { at: { x: 7, y: 1 } },
        kael: { actions: [LONGSWORD, HEALING_WORD] }, resources: { "slot-1": 2 }
      }));
      expect(turn.used.find((use) => use.actionId === "healing-word")?.targetId).toBe("mira");
      expect(turn.used.some((use) => use.actionId === "drink:give")).toBe(false);
      expect(turn.potionsLeft).toBe(3);
      expect(turn.attacked).toBe(true);
    }
  });
});

describe("other items", () => {
  it("a vial of acid isn't thrown when the longsword in reach does better", () => {
    const turn = kaelsTurn(scene({ hp: 52, orcs: ADJACENT_ONE, kael: { items: [ACID] }, resources: { "item:acid": 2 } }));
    expect(turn.attacked).toBe(true);
    expect(turn.used.some((use) => use.actionId === "acid-throw")).toBe(false);
  });
});
