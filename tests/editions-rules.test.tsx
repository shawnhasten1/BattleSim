// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  attackRollInputs,
  conditionByDm,
  createEngineState,
  defaultConditionModifiers,
  getExecutableActions,
  initiativeOf,
  rollInitiative,
  sampleEncounter,
  SeededRandom,
  turnMovementBudget,
  type AttackActionDefinition,
  type ConditionInstance,
  type CreatureDefinition,
  type EncounterSnapshot,
  type RandomSource,
  type RuleProfile
} from "@/engine";
import { CampaignRules } from "@/components/campaigns/CampaignRules";
import { hasGrapplers, hasStunners, hasSurprised, parseCampaignRules, ruleInForce, withCampaignRules, type CampaignRules as Rules } from "@/lib/campaign-rules";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * EDITIONS_PLAN.md Phase 3: the rules that differ between the editions but belong to no spell or class, each a named
 * table rule (D4). Their defaults are today's behaviour, so nothing already seeded moves.
 */

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
afterEach(() => cleanup());

/** The sample fight, open ground, under these rules. */
function scene(rules: Partial<RuleProfile> = {}) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.rules = { ...snapshot.rules, ...rules };
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") token.position = { x: 3, y: 3 };
    if (token.id === "pc-archer") token.position = { x: 5, y: 3 };
    if (token.id === "enemy-goblin-1") token.position = { x: 4, y: 3 };
  }
  const state = createEngineState(snapshot);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  const scimitar = getExecutableActions(snapshot.definitions.find((entry) => entry.id === "def-goblin")!)
    .find((action): action is AttackActionDefinition => action.kind === "attack" && action.attackType === "melee")!;
  return { state, find, scimitar };
}

const held = (by: string): ConditionInstance => ({ id: "held", name: "grappled", sourceCombatantId: by, startedRound: 1, modifiers: defaultConditionModifiers("grappled") });

describe("Grappled", () => {
  it("2024: disadvantage on attacks against anyone but the grappler", () => {
    const { state, find, scimitar } = scene({ grappled: "speed-and-attacks" });
    find("enemy-goblin-1").conditions = [held("pc-fighter")];
    const atArcher = attackRollInputs(state, find("enemy-goblin-1"), find("pc-archer"), scimitar);
    expect(atArcher.disadvantage).toBe(true);
    expect(atArcher.featureAdvantage.sources).toContain("Grappled");
    expect(attackRollInputs(state, find("enemy-goblin-1"), find("pc-fighter"), scimitar).disadvantage).toBe(false);
  });

  it("2014 (the default): speed 0 only", () => {
    for (const rules of [{}, { grappled: "speed" as const }]) {
      const { state, find, scimitar } = scene(rules);
      find("enemy-goblin-1").conditions = [held("pc-fighter")];
      expect(attackRollInputs(state, find("enemy-goblin-1"), find("pc-archer"), scimitar).disadvantage).toBe(false);
      // Held in place: its speed divided by 999, less than a square.
      expect(turnMovementBudget(state.snapshot, find("enemy-goblin-1"))).toBeLessThan(1);
    }
  });

  it("a grapple put on by hand has no grappler, so it costs no attacks", () => {
    const { state, find, scimitar } = scene({ grappled: "speed-and-attacks" });
    find("enemy-goblin-1").conditions = [{ ...held("pc-fighter"), sourceCombatantId: undefined }];
    expect(attackRollInputs(state, find("enemy-goblin-1"), find("pc-archer"), scimitar).disadvantage).toBe(false);
  });
});

describe("Stunned", () => {
  it("2024: can still move, and still can't act", () => {
    const modifiers = defaultConditionModifiers("stunned", { stunned: "can-move" })!;
    expect(modifiers).toMatchObject({ deniesActions: true, deniesBonusActions: true, deniesReactions: true, incomingAttackRoll: 5 });
    expect(modifiers.movementMultiplier).toBeUndefined();
    const { state, find } = scene({ stunned: "can-move" });
    conditionByDm(state, "pc-fighter", { add: "stunned" });
    expect(find("pc-fighter").conditions!.find((condition) => condition.name === "stunned")!.modifiers?.movementMultiplier).toBeUndefined();
    expect(turnMovementBudget(state.snapshot, find("pc-fighter"))).toBeGreaterThanOrEqual(6);
  });

  it("2014 (the default): can't move", () => {
    expect(defaultConditionModifiers("stunned")!.movementMultiplier).toBe(999);
    const { state, find } = scene();
    conditionByDm(state, "pc-fighter", { add: "stunned" });
    expect(turnMovementBudget(state.snapshot, find("pc-fighter"))).toBeLessThan(1);
  });

  it("leaves paralyzed and unconscious as they are", () => {
    expect(defaultConditionModifiers("paralyzed", { stunned: "can-move" })!.movementMultiplier).toBe(999);
  });
});

describe("Surprise", () => {
  /** Dice from a list, then a seeded stream. */
  function scripted(values: number[]): RandomSource {
    const queue = [...values];
    const fallback = new SeededRandom("surprise");
    const source: RandomSource = {
      next: () => fallback.next(),
      nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
      fork: () => source
    };
    return source;
  }
  const surprised = (snapshot: EncounterSnapshot, rules?: Partial<RuleProfile>): ConditionInstance => ({
    id: "surprised", name: "surprised", startedRound: snapshot.round, expiresAt: { round: 2, turnIndex: 0, timing: "start" },
    modifiers: defaultConditionModifiers("surprised", rules)
  });
  function roll(rules: Partial<RuleProfile>, conditionRules: Partial<RuleProfile> | undefined, dice: number[]) {
    const snapshot = structuredClone(sampleEncounter);
    snapshot.rules = { ...snapshot.rules, ...rules };
    snapshot.combatants = [snapshot.combatants.find((token) => token.id === "pc-fighter")!, ...snapshot.combatants.filter((token) => token.id !== "pc-fighter")];
    snapshot.combatants[0]!.conditions = [surprised(snapshot, conditionRules)];
    const state = createEngineState(snapshot);
    state.rng = scripted(dice);
    rollInitiative(state);
    const fighter = state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    const logged = (state.log.find((entry) => entry.type === "InitiativeRolled")?.data?.rolls as Array<{ combatantId: string; total: number; features?: string[] }>)
      .find((entry) => entry.combatantId === "pc-fighter")!;
    return { fighter, logged };
  }
  const dex = (sampleEncounter.definitions.find((entry) => entry.id === "def-fighter") as CreatureDefinition).abilities.dex;
  const dexMod = Math.floor((dex - 10) / 2);

  it("2024: initiative at disadvantage, and nothing else", () => {
    const { fighter, logged } = roll({ surprise: "initiative" }, { surprise: "initiative" }, [17, 4]);
    expect(logged).toMatchObject({ total: 4 + dexMod, features: ["Surprised"] });
    expect(fighter.conditions!.find((condition) => condition.name === "surprised")!.modifiers).toBeUndefined();
    expect(initiativeOf(sampleEncounter.definitions[0]!, fighter, { surprise: "initiative" }).disadvantage).toBe(true);
  });

  it("2024: a surprise ticked before the rule changed loses no turn either", () => {
    const { fighter } = roll({ surprise: "initiative" }, undefined, [17, 4]);
    expect(fighter.conditions!.find((condition) => condition.name === "surprised")!.modifiers).toBeUndefined();
  });

  it("2014 (the default): an ordinary roll, and the first turn lost", () => {
    const { fighter, logged } = roll({}, undefined, [17, 4]);
    expect(logged.total).toBe(17 + dexMod);
    expect(fighter.conditions!.find((condition) => condition.name === "surprised")!.modifiers).toMatchObject({ deniesActions: true, movementMultiplier: 999 });
  });

  it("the store's surprise follows the table's rule", () => {
    const store = useEncounterStore.getState();
    useEncounterStore.setState({ encounter: { ...store.encounter, rules: { ...store.encounter.rules, surprise: "initiative" } } });
    useEncounterStore.getState().setFactionSurprised("enemy", true);
    const goblin = useEncounterStore.getState().encounter.combatants.find((token) => token.id === "enemy-goblin-1")!;
    expect(goblin.conditions!.find((condition) => condition.name === "surprised")!.modifiers).toBeUndefined();
  });
});

describe("as campaign rules", () => {
  it("go into the snapshot and say what they are", () => {
    const encounter = withCampaignRules(structuredClone(sampleEncounter), { grappled: "speed-and-attacks", stunned: "can-move", surprise: "initiative" });
    expect(encounter.rules).toMatchObject({ grappled: "speed-and-attacks", stunned: "can-move", surprise: "initiative" });
    expect(ruleInForce(encounter, "grappled")).toBe("Grappled: speed 0, and disadvantage on attacks against anyone but the grappler");
    expect(ruleInForce(encounter, "stunned")).toBe("Stunned creatures can still move");
    expect(ruleInForce(encounter, "surprise")).toBe("Surprised creatures roll initiative at disadvantage");
    expect(ruleInForce(sampleEncounter, "surprise")).toBe("Surprised creatures lose their first turn");
  });

  it("are read from what's saved, and a setting that isn't one is refused", () => {
    expect(parseCampaignRules(JSON.stringify({ grappled: "speed-and-attacks", stunned: "can-move", surprise: "initiative" })))
      .toEqual({ grappled: "speed-and-attacks", stunned: "can-move", surprise: "initiative" });
    expect(parseCampaignRules(JSON.stringify({ stunned: "sometimes" }))).toEqual({});
  });

  it("are mentioned where they matter", () => {
    expect(hasGrapplers(sampleEncounter)).toBe(false);
    expect(hasStunners(sampleEncounter)).toBe(false);
    expect(hasSurprised(sampleEncounter)).toBe(false);
    const goblin = sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!;
    const scimitar = goblin.actions.find((action) => action.kind === "attack")!;
    const grappling = { ...goblin, actions: [{ ...scimitar, riders: [{ kind: "hold" as const, escapeDc: 12 }] }] } as CreatureDefinition;
    const stunning = { ...goblin, actions: [{ ...scimitar, riders: [{ kind: "condition" as const, condition: "stunned" as const, when: "on-hit" as const }] }] } as CreatureDefinition;
    expect(hasGrapplers({ definitions: [grappling] })).toBe(true);
    expect(hasStunners({ definitions: [stunning] })).toBe(true);
  });

  it("each is a choice in the campaign's rules, its options saying which edition's they are", async () => {
    const seen: unknown[] = [];
    useEncounterStore.setState({ setCampaignRules: async (_id: string, rules: unknown) => { seen.push(rules); return true; } } as never);
    let rules: Rules = {};
    render(<CampaignRules campaignId="c1" rules={rules} onChange={(next) => { rules = next; }} />);
    for (const [label, options] of [
      ["Being grappled", ["Speed 0 (2014 rules)", "Speed 0, and disadvantage on attacks against anyone but the grappler (2024 rules)"]],
      ["Being stunned", ["Can't move (2014 rules)", "Can still move (2024 rules)"]],
      ["Being surprised", ["No actions, reactions or movement on its first turn (2014 rules)", "Rolls initiative at disadvantage (2024 rules)"]]
    ] as const) {
      const select = screen.getByRole("combobox", { name: label }) as HTMLSelectElement;
      expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(options);
    }
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Being stunned" }), "can-move");
    expect(seen).toEqual([{ stunned: "can-move" }]);
  });
});
