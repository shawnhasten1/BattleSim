import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleEncounter, type ActionDefinition, type CombatantState } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";

/** Lair actions through the store: authoring them, the "in its lair" toggle, and Step mode taking them on initiative 20. */
const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
afterEach(() => useEncounterStore.setState(pristine, true));

const store = () => useEncounterStore.getState();
const eruption: ActionDefinition = {
  kind: "area-save", id: "", name: "Magma Eruption", actionType: "action", saveAbility: "dex", dc: 15, range: 120, area: { type: "circle", size: 10 },
  targeting: { origin: "point", range: 120 }, damage: [{ dice: "3d6", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile", automationSupport: "full"
};

function setUp() {
  const encounter = structuredClone(sampleEncounter);
  // The fighter rolls high, the goblins low: the lair's slot falls between them.
  encounter.combatants = encounter.combatants.map((combatant): CombatantState => ({
    ...combatant,
    initiative: combatant.faction === "party" ? (combatant.id === "pc-fighter" ? 24 : 18) : combatant.id.endsWith("1") ? 12 : 8
  }));
  useEncounterStore.setState({ encounter, log: [] });
  const goblin = encounter.combatants.find((combatant) => combatant.faction === "enemy")!;
  const ref = store().insertAbilityRecord(goblin.definitionId, "lairActions", eruption);
  return { goblin, id: ref && "id" in ref ? ref.id : "" };
}

describe("lair actions in the store", () => {
  it("adds and edits a lair action on the creature", () => {
    const { goblin, id } = setUp();
    const definition = () => store().encounter.definitions.find((candidate) => candidate.id === goblin.definitionId)!;
    expect(definition().lairActions).toHaveLength(1);
    expect(definition().lairActions![0]).toMatchObject({ id, name: "Magma Eruption", actionType: "action" });
    store().replaceAbilityRecord(goblin.definitionId, { list: "lairActions", id }, { ...definition().lairActions![0]!, name: "Tremor" });
    expect(definition().lairActions![0]!.name).toBe("Tremor");
    store().removeDefinitionItem(goblin.definitionId, "lairAction", id);
    expect(definition().lairActions).toEqual([]);
  });

  it("toggles a token in and out of its lair (one undo step each)", () => {
    const { goblin } = setUp();
    store().setInLair([goblin.id], true);
    expect(store().encounter.combatants.find((combatant) => combatant.id === goblin.id)!.inLair).toBe(true);
    store().setInLair([goblin.id], false);
    expect(store().encounter.combatants.find((combatant) => combatant.id === goblin.id)!.inLair).toBeUndefined();
  });

  it("Step takes the lair action on initiative 20: after the 24, before the 18", () => {
    const { goblin } = setUp();
    store().setInLair([goblin.id], true);
    const stepTo = (count: number) => { for (let i = 0; i < count; i += 1) store().advanceTurn(); };
    stepTo(1); // the fighter (24)
    expect(store().log.some((entry) => entry.type === "LairAction")).toBe(false);
    stepTo(1); // the archer (18): the lair goes first
    const lair = store().log.findIndex((entry) => entry.type === "LairAction");
    const archerTurn = store().log.findIndex((entry) => entry.type === "TurnStarted" && entry.data?.combatantId === "pc-archer");
    expect(lair).toBeGreaterThan(-1);
    expect(lair).toBeLessThan(archerTurn);
    expect(store().log[lair]!.message).toMatch(/^Lair action \(initiative 20\): .* uses Magma Eruption$/);
    stepTo(2); // the goblins: no second lair action this round
    expect(store().log.filter((entry) => entry.type === "LairAction")).toHaveLength(1);
  });

  it("out of its lair, Step takes none", () => {
    setUp();
    for (let i = 0; i < 4; i += 1) store().advanceTurn();
    expect(store().log.some((entry) => entry.type === "LairAction")).toBe(false);
  });
});
