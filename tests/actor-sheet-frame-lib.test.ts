import { beforeEach, describe, expect, it } from "vitest";
import { defaultConditionModifiers, type ActionDefinition, type CombatantState, type ConditionInstance } from "@/engine";
import { automationSummary } from "@/lib/actor-sheet/ai-uses";
import { concentrationOf, describeCondition, statusOf } from "@/lib/actor-sheet/conditions";
import { combatantPackage } from "@/lib/actor-sheet/export";
import { creatureScope, libraryStatus, tokensOf } from "@/lib/actor-sheet/scope";
import { speedLine } from "@/lib/actor-sheet/summaries";
import { useEncounterStore } from "@/store/encounter-store";

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));

const store = () => useEncounterStore.getState();
const token = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!;
const definition = (id: string) => store().encounter.definitions.find((candidate) => candidate.id === id)!;

/** Puts `patch` on a token, outside the undo history. */
function patchToken(id: string, patch: Partial<CombatantState>) {
  useEncounterStore.setState((state) => ({
    encounter: { ...state.encounter, combatants: state.encounter.combatants.map((combatant) => (combatant.id === id ? { ...combatant, ...patch } : combatant)) }
  }));
}

describe("a condition added by hand", () => {
  it("has the engine's modifiers for its name, so prone from the sheet is prone from a fall", () => {
    store().applyConditionToCombatant("enemy-goblin-1", "prone");
    const prone = token("enemy-goblin-1").conditions!.find((condition) => condition.name === "prone")!;
    expect(prone.modifiers).toEqual(defaultConditionModifiers("prone"));
    expect(describeCondition(prone, token("enemy-goblin-1"), store().encounter)).toEqual({
      effects: ["-2 to hit", "stands up at the start of its turn, for half its movement"],
      ends: ["Lasts until it's removed"]
    });
  });

  it("comes off one at a time, as one undo step, and nothing happens for one it doesn't have", () => {
    store().applyConditionToCombatant("enemy-goblin-1", "prone");
    store().applyConditionToCombatant("enemy-goblin-1", "poisoned");
    const [prone] = token("enemy-goblin-1").conditions!;
    const steps = store().undoStack.length;
    store().removeCondition("enemy-goblin-1", prone!.id);
    expect(token("enemy-goblin-1").conditions!.map((condition) => condition.name)).toEqual(["poisoned"]);
    expect(store().undoStack).toHaveLength(steps + 1);
    store().removeCondition("enemy-goblin-1", "no-such-condition");
    expect(store().undoStack).toHaveLength(steps + 1);
  });
});

describe("describing a condition", () => {
  it("says a creature that can't act can't, then the rest", () => {
    const stunned: ConditionInstance = { id: "s", name: "stunned", startedRound: 1, modifiers: defaultConditionModifiers("stunned") };
    expect(describeCondition(stunned, token("enemy-goblin-1"), store().encounter).effects).toEqual(["can't act or react", "can't move", "attackers have advantage"]);
  });

  it("names its source and everything that ends it", () => {
    const held: ConditionInstance = {
      id: "h", name: "paralyzed", startedRound: 1, sourceName: "Hold Person", sourceCombatantId: "pc-fighter", concentration: true,
      repeatSave: { ability: "wis", dc: 15, timing: "turn-end" }, modifiers: defaultConditionModifiers("paralyzed")
    };
    const described = describeCondition(held, token("enemy-goblin-1"), store().encounter);
    expect(described.source).toBe("From Hold Person (Fighter)");
    expect(described.ends).toEqual(["Ends when Fighter stops concentrating", "Ends on a DC 15 Wisdom save at the end of its turn"]);
  });

  it("says when the simulator doesn't model it", () => {
    const invisible: ConditionInstance = { id: "i", name: "invisible", startedRound: 1 };
    expect(describeCondition(invisible, token("enemy-goblin-1"), store().encounter).effects).toEqual(["The simulator doesn't model it"]);
  });
});

describe("a token's state", () => {
  it("names what it's concentrating on", () => {
    expect(concentrationOf(token("pc-fighter"), store().encounter)).toBeUndefined();
    patchToken("pc-fighter", { concentration: {} });
    patchToken("enemy-goblin-1", { conditions: [{ id: "h", name: "paralyzed", startedRound: 1, sourceName: "Hold Person", sourceCombatantId: "pc-fighter", concentration: true }] });
    expect(concentrationOf(token("pc-fighter"), store().encounter)).toBe("Hold Person");
  });

  it("reads its death saves and reinforcement round", () => {
    expect(statusOf(token("pc-fighter"))).toBeUndefined();
    expect(statusOf({ ...token("pc-fighter"), state: "downed", deathSaves: { successes: 2, failures: 1, stable: false } })).toBe("Downed · death saves 2✓ 1✗");
    expect(statusOf({ ...token("pc-fighter"), state: "downed", deathSaves: { successes: 0, failures: 0, stable: true } })).toBe("Downed · stable");
    expect(statusOf({ ...token("pc-fighter"), state: "reserve", arrivesRound: 3 })).toBe("Arrives round 3");
  });
});

describe("what the creature tabs change", () => {
  it("counts the tokens of a creature and names them", () => {
    const scope = creatureScope(store().encounter, definition("def-goblin"), "scene");
    expect(scope.caption).toBe("2 tokens in this scene");
    expect(scope.help).toBe("Changes here apply to every Imported Goblin Stand-in in this scene: Goblin 1 and Goblin 2. It isn't in your library: save it there from ⋯.");
    expect(creatureScope(store().encounter, definition("def-fighter"), "saved").caption).toBe("its only token");
  });

  it("counts a token in another form for that form", () => {
    patchToken("enemy-goblin-2", { activeForm: { definitionId: "def-archer" } });
    expect(tokensOf(store().encounter, "def-goblin").map((combatant) => combatant.id)).toEqual(["enemy-goblin-1"]);
    expect(tokensOf(store().encounter, "def-archer").map((combatant) => combatant.id)).toEqual(["pc-archer", "enemy-goblin-2"]);
  });

  it("knows where the creature stands with the library", () => {
    expect(libraryStatus({ id: "srd:monster:goblin" }, [], [])).toBe("srd");
    expect(libraryStatus({ id: "def-goblin" }, [{ id: "def-goblin" }], [])).toBe("saved");
    expect(libraryStatus({ id: "def-goblin" }, [{ id: "def-goblin" }], ["def-goblin"])).toBe("template");
    expect(libraryStatus({ id: "def-goblin" }, [], [])).toBe("scene");
  });
});

describe("the title bar's automation count", () => {
  it("counts the Abilities list's dots, and names what isn't simulated", () => {
    const plain = automationSummary(definition("def-goblin"), token("enemy-goblin-1"));
    expect(plain.worst).toBe("simulated");
    expect(plain.simulated).toBe(plain.total);
    const gaze: ActionDefinition = { kind: "unsupported", id: "gaze", name: "Petrifying Gaze", actionType: "action", automationSupport: "unsupported", description: "Turns to stone." };
    const withGaze = { ...definition("def-goblin"), actions: [...definition("def-goblin").actions, gaze] };
    const summary = automationSummary(withGaze, token("enemy-goblin-1"));
    expect(summary).toMatchObject({ total: plain.total + 1, simulated: plain.simulated, worst: "reference", reference: ["Petrifying Gaze"] });
  });
});

describe("export and speed", () => {
  it("export leaves out what only matters mid-fight", () => {
    const exported = combatantPackage({ ...token("pc-fighter"), initiative: 12, concentration: {} }, definition("def-fighter"), "now");
    expect(exported).toMatchObject({ kind: "battle-sim-combatant", exportedAt: "now", definition: { id: "def-fighter" } });
    expect(Object.keys(exported.combatant!)).not.toEqual(expect.arrayContaining(["id"]));
    expect(exported.combatant).not.toHaveProperty("initiative");
    expect(exported.combatant).not.toHaveProperty("concentration");
    expect(exported.combatant).not.toHaveProperty("definitionId");
  });

  it("speed reads as a statblock prints it", () => {
    expect(speedLine({ speed: 40, movement: { walk: 40, climb: 40, fly: 80 } })).toBe("40 ft, climb 40 ft, fly 80 ft");
    expect(speedLine({ speed: 30, movement: { walk: 30, fly: 30, hover: true } })).toBe("30 ft, fly 30 ft (hover)");
    expect(speedLine({ speed: 25 })).toBe("25 ft");
  });
});
