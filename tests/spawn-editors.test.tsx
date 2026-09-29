// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { sampleEncounter, type CreatureDefinition, type SummonActionDefinition, type TransformActionDefinition } from "@/engine";
import { SummonEditor, TransformEditor } from "@/components/sheet/builders/SpawnEditors";
import { useEncounterStore } from "@/store/encounter-store";

afterEach(() => {
  document.body.innerHTML = "";
});

const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

describe("SummonEditor", () => {
  it("builds a summon from picked creatures, counts, a chance and a duration", async () => {
    let saved: SummonActionDefinition | undefined;
    render(<SummonEditor ownerId="owner" sceneActors={[]} onSave={(action) => { saved = action; }} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText("Add a creature to summon"), "dretch");
    await userEvent.click(await screen.findByRole("button", { name: /Dretch/ }));
    await userEvent.type(screen.getByLabelText("Add a creature to summon"), "vrock");
    await userEvent.click(await screen.findByRole("button", { name: /Vrock/ }));
    const count = screen.getByLabelText("Count for Dretch");
    await userEvent.clear(count);
    await userEvent.type(count, "2d6");
    await userEvent.type(screen.getByLabelText("Chance"), "30");
    await userEvent.click(screen.getByLabelText(/once per encounter/));
    await userEvent.click(screen.getByRole("button", { name: "Add summon" }));
    expect(saved).toMatchObject({
      kind: "summon", chance: 30, choice: "pick", durationRounds: 10, maxGeneration: 1,
      options: [{ definitionId: "srd:monster:dretch", count: { dice: "2d6" } }, { definitionId: "srd:monster:vrock", count: 1 }],
      resourceCost: { resourceId: "usage:summon", amount: 1 }
    });
  });

  it("can't be saved with nothing to summon", () => {
    render(<SummonEditor ownerId="owner" sceneActors={[]} onSave={() => {}} onCancel={() => {}} />);
    expect((screen.getByRole("button", { name: "Add summon" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers the scene's own actors too", async () => {
    render(<SummonEditor ownerId="owner" sceneActors={[{ ...fighter, id: "def-mine", name: "Zorbo Guard" }]} onSave={() => {}} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText("Add a creature to summon"), "zorbo");
    expect(await screen.findByRole("button", { name: /Zorbo Guard/ })).toBeTruthy();
  });
});

describe("TransformEditor", () => {
  it("builds a shapechange with a label per form", async () => {
    let saved: TransformActionDefinition | undefined;
    render(<TransformEditor ownerId="owner" sceneActors={[]} onSave={(action) => { saved = action; }} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText("Add a form to change into"), "wolf");
    await userEvent.click(await screen.findByRole("button", { name: /^Wolf/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add shapechange" }));
    expect(saved).toMatchObject({ kind: "transform", canRevert: true, revertOnDeath: true, forms: [{ definitionId: "srd:monster:wolf", label: "Wolf" }] });
  });
});

describe("addSpawnAction", () => {
  const store = () => useEncounterStore.getState();
  const summon = (target: string, extra: Partial<SummonActionDefinition> = {}): SummonActionDefinition => ({
    kind: "summon", id: "s", name: "Call", actionType: "action", range: 60, options: [{ id: "o", definitionId: target, label: "x", count: 1 }], choice: "pick", automationSupport: "full", ...extra
  });

  it("embeds the creatures a summon names, and seeds a limited summon's pool", async () => {
    useEncounterStore.setState({ encounter: structuredClone(sampleEncounter) });
    const id = await store().addSpawnAction("def-fighter", summon("srd:monster:goblin", { resourceCost: { resourceId: "usage:summon", amount: 1 } }));
    expect(id).toBeTruthy();
    expect(store().encounter.definitions.some((definition) => definition.id === "srd:monster:goblin")).toBe(true);
    const owner = store().encounter.definitions.find((definition) => definition.id === "def-fighter")!;
    expect(owner.actions.some((action) => action.id === id && action.kind === "summon")).toBe(true);
    expect(owner.resources?.["usage:summon"]).toBe(1);
    expect(store().encounter.combatants.filter((combatant) => combatant.definitionId === "def-fighter").every((combatant) => combatant.resources?.["usage:summon"] === 1)).toBe(true);
  });

  it("refuses a summon that loops back on its owner", async () => {
    const a: CreatureDefinition = { ...fighter, id: "def-a", name: "A" };
    const b: CreatureDefinition = { ...fighter, id: "def-b", name: "B", actions: [{ ...summon("def-a"), id: "back" }] };
    useEncounterStore.setState({ encounter: { ...structuredClone(sampleEncounter), definitions: [a, b] } });
    const id = await store().addSpawnAction("def-a", summon("def-b"));
    expect(id).toBeUndefined();
    expect(store().definitionStatus).toMatch(/loop/);
    expect(store().encounter.definitions.find((definition) => definition.id === "def-a")!.actions.some((action) => action.kind === "summon")).toBe(false);
  });

  it("gives every form a copy of the transform so it can always change again", async () => {
    useEncounterStore.setState({ encounter: structuredClone(sampleEncounter) });
    const id = await store().addSpawnAction("def-fighter", {
      kind: "transform", id: "t", name: "Shift", actionType: "action", canRevert: true, revertOnDeath: true, automationSupport: "full",
      forms: [{ id: "wolf", label: "Wolf", definitionId: "srd:monster:wolf" }]
    });
    const wolf = store().encounter.definitions.find((definition) => definition.id === "srd:monster:wolf")!;
    expect(wolf.actions.some((action) => action.id === id && action.kind === "transform")).toBe(true);
  });
});
