import { describe, expect, it } from "vitest";
import {
  createEngineState, escapeChance, resolveAttack, resolveUtilityAction, runAutomatedEncounter, runTurnStart, sampleEncounter, takeAutomatedTurn, updateDefeatState,
  type ActionRider, type CombatantState, type CreatureDefinition, type EncounterSnapshot
} from "@/engine";

/** Grapples: a hold rider grips on a hit; escape with an action; the grip ends when the holder can't keep it. */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

const hold = (extra: Partial<Extract<ActionRider, { kind: "hold" }>> = {}): ActionRider => ({ kind: "hold", when: "on-hit", escapeDc: 13, ...extra });
const crocodile = (rider: ActionRider = hold({ restrained: true }), size: CreatureDefinition["size"] = "large"): CreatureDefinition => ({
  id: "def-croc", name: "Croc", size, armorClass: 10, maxHp: 100, speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  actions: [{ kind: "attack", id: "bite", name: "Bite", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5, damage: [{ dice: "1", damageType: "piercing" }], riders: [rider], automationSupport: "full" }]
});

const victim = (size: CreatureDefinition["size"] = "medium", str = 10): CreatureDefinition => ({ ...fighter, id: "def-victim", size, maxHp: 500, armorClass: 1, abilities: { ...fighter.abilities, str, dex: 10 }, skills: undefined });

function scene(holder: CreatureDefinition, target: CreatureDefinition, extraVictims = 0, seed = "grip"): EncounterSnapshot {
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number, y = 4): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
  });
  const base = structuredClone(sampleEncounter);
  const victims = [token("victim", target, "party", 4), ...Array.from({ length: extraVictims }, (_, index) => token(`victim-${index + 2}`, target, "party", 4, 5 + index))];
  return { ...base, seed, map: { ...base.map, walls: [], terrain: [] }, definitions: [target, holder], combatants: [...victims, token("croc", holder, "enemy", 5)] };
}
const conds = (state: ReturnType<typeof createEngineState>, id = "victim") => (state.snapshot.combatants.find((entry) => entry.id === id)!.conditions ?? []).map((condition) => condition.name).sort();
const strike = (state: ReturnType<typeof createEngineState>, target = "victim") => {
  state.snapshot.combatants.find((entry) => entry.id === "croc")!.actionEconomy = undefined;
  resolveAttack(state, "croc", target, "bite");
};

describe("hold rider", () => {
  it("grapples on a hit, and restrains when the rider says so", () => {
    const state = createEngineState(scene(crocodile(), victim()));
    strike(state);
    expect(conds(state)).toEqual(["grappled", "restrained"]);
    expect(state.log.some((entry) => entry.type === "HoldApplied" && /escape DC 13/.test(entry.message))).toBe(true);
    const plain = createEngineState(scene(crocodile(hold()), victim()));
    strike(plain);
    expect(conds(plain)).toEqual(["grappled"]);
  });

  it("skips a target that is too big", () => {
    const state = createEngineState(scene(crocodile(hold({ maxSize: "medium" })), victim("large")));
    strike(state);
    expect(conds(state)).toEqual([]);
  });

  it("holds only as many creatures as its limit", () => {
    const one = createEngineState(scene(crocodile(hold({ limit: 1 })), victim(), 1));
    strike(one, "victim");
    strike(one, "victim-2");
    expect(conds(one, "victim")).toEqual(["grappled"]);
    expect(conds(one, "victim-2")).toEqual([]);

    const two = createEngineState(scene(crocodile(hold({ limit: 2 })), victim(), 1));
    strike(two, "victim");
    strike(two, "victim-2");
    expect(conds(two, "victim-2")).toEqual(["grappled"]);
  });

  it("a held creature can't move away (its speed is zero)", () => {
    const state = createEngineState(scene(crocodile(), victim()));
    strike(state);
    const held = state.snapshot.combatants.find((entry) => entry.id === "victim")!;
    expect(held.conditions!.every((condition) => (condition.modifiers?.movementMultiplier ?? 1) >= 999)).toBe(true);
  });
});

describe("escaping", () => {
  const escapeAction = (state: ReturnType<typeof createEngineState>) => {
    const victimState = state.snapshot.combatants.find((entry) => entry.id === "victim")!;
    victimState.actionEconomy = undefined;
    resolveUtilityAction(state, "victim", "utility:escape");
  };

  it("a strong creature breaks free and is released from both conditions", () => {
    const state = createEngineState(scene(crocodile(hold({ restrained: true, escapeDc: 5 })), victim("medium", 30)));
    strike(state);
    escapeAction(state);
    expect(conds(state)).toEqual([]);
    expect(state.log.some((entry) => entry.type === "EscapeAttempted" && entry.data?.success === true)).toBe(true);
  });

  it("a weak one against a hard grip stays held", () => {
    const state = createEngineState(scene(crocodile(hold({ restrained: true, escapeDc: 40 })), victim()));
    strike(state);
    escapeAction(state);
    expect(conds(state)).toEqual(["grappled", "restrained"]);
  });

  it("escapeChance reflects the bonus and the DC, and is zero when not held", () => {
    const state = createEngineState(scene(crocodile(hold({ escapeDc: 20 })), victim("medium", 20)));
    const target = state.snapshot.combatants.find((entry) => entry.id === "victim")!;
    expect(escapeChance(victim("medium", 20), target)).toBe(0);
    strike(state);
    expect(escapeChance(victim("medium", 20), target)).toBeCloseTo(0.3, 5); // +5 vs DC 20 needs a 15
  });

  it("the AI spends its action escaping a restraining hold it has a fair chance against", () => {
    const state = createEngineState(scene(crocodile(hold({ restrained: true, escapeDc: 8 })), victim("medium", 16)));
    strike(state);
    const held = state.snapshot.combatants.find((entry) => entry.id === "victim")!;
    held.actionEconomy = undefined;
    takeAutomatedTurn(state, held);
    expect(state.log.some((entry) => entry.type === "EscapeAttempted")).toBe(true);
  });
});

describe("the grip ends when the holder can't keep it", () => {
  it("holder defeated: everyone is let go", () => {
    const state = createEngineState(scene(crocodile(), victim()));
    strike(state);
    const holder = state.snapshot.combatants.find((entry) => entry.id === "croc")!;
    holder.currentHp = 0;
    updateDefeatState(state, holder);
    expect(conds(state)).toEqual([]);
  });

  it("holder incapacitated: released at the victim's next turn", () => {
    const state = createEngineState(scene(crocodile(), victim()));
    strike(state);
    state.snapshot.combatants.find((entry) => entry.id === "croc")!.conditions = [{ id: "s", name: "stunned", startedRound: 1, modifiers: { deniesActions: true } }];
    runTurnStart(state, state.snapshot.combatants.find((entry) => entry.id === "victim")!);
    expect(conds(state)).toEqual([]);
  });

  it("holder out of reach: released", () => {
    const state = createEngineState(scene(crocodile(), victim()));
    strike(state);
    state.snapshot.combatants.find((entry) => entry.id === "victim")!.position = { x: 12, y: 4 };
    runTurnStart(state, state.snapshot.combatants.find((entry) => entry.id === "victim")!);
    expect(conds(state)).toEqual([]);
  });

  it("recurring damage at the start of the held creature's turn", () => {
    const rider = hold({ restrained: true, recurringDamage: [{ dice: "7", damageType: "piercing" }] });
    const state = createEngineState(scene(crocodile(rider), victim()));
    strike(state);
    const held = state.snapshot.combatants.find((entry) => entry.id === "victim")!;
    const before = held.currentHp;
    runTurnStart(state, held);
    expect(before - held.currentHp).toBe(7);
  });
});

describe("a fight with grapplers", () => {
  it("runs to a finish without losing turns", () => {
    const result = runAutomatedEncounter(scene(crocodile(hold({ restrained: true, escapeDc: 12 })), { ...victim(), maxHp: 30 }, 1, "fight"), 30);
    expect(result.outcome.completed).toBe(true);
    expect(result.log.filter((entry) => entry.type === "AutomationWarning" && /failed/.test(entry.message))).toEqual([]);
    expect(result.log.some((entry) => entry.type === "HoldApplied")).toBe(true);
  });
});
