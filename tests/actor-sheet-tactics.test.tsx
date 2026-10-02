// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CombatantState } from "@/engine";
import { ActorSheet } from "@/components/sheet/ActorSheet";
import { TokenTab } from "@/components/sheet/sheet-tabs/TokenTab";
import type { Compendium } from "@/hooks/useCompendium";
import { findAbility, type AbilityRef } from "@/lib/ability-editor/refs";
import { RESOURCE_STANCES } from "@/lib/resource-stances";
import { TACTICS_PROFILES } from "@/lib/tactics-profiles";
import { useEncounterStore } from "@/store/encounter-store";

/** The actor sheet plan's Phase 5, driven: Token › Tactics. */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const store = () => useEncounterStore.getState();
const token = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!;
const creature = (id: string) => store().encounter.definitions.find((definition) => definition.id === id)!;

function LiveToken({ id, onOpenAbility = () => undefined }: { id: string; onOpenAbility?: (ref: AbilityRef) => void }) {
  const encounter = useEncounterStore((s) => s.encounter);
  const combatant = encounter.combatants.find((candidate) => candidate.id === id)!;
  const definition = encounter.definitions.find((candidate) => candidate.id === (combatant.activeForm?.definitionId ?? combatant.definitionId))!;
  return <TokenTab combatant={combatant} definition={definition} onOpenAbility={onOpenAbility} />;
}

function patchToken(id: string, patch: Partial<CombatantState>) {
  useEncounterStore.setState((state) => ({
    encounter: { ...state.encounter, combatants: state.encounter.combatants.map((combatant) => (combatant.id === id ? { ...combatant, ...patch } : combatant)) },
    undoStack: []
  }));
}

const tactics = () => within(screen.getByRole("region", { name: "Tactics" }));
const describe_ = (list: Array<{ value: string; description: string }>, value: string) => list.find((option) => option.value === value)!.description;

describe("Token › Tactics", { timeout: 20000 }, () => {
  it("shows what the profile and the spending do, and changes them for this token", async () => {
    render(<LiveToken id="pc-fighter" />);
    expect(tactics().getByText(describe_(TACTICS_PROFILES, "basic-melee"))).toBeTruthy();
    await userEvent.selectOptions(tactics().getByRole("combobox", { name: "Tactics profile" }), "brute");
    expect(token("pc-fighter").tacticsProfile).toBe("brute");
    expect(tactics().getByText(describe_(TACTICS_PROFILES, "brute"))).toBeTruthy();
    await userEvent.click(within(tactics().getByRole("radiogroup", { name: "Spending" })).getByRole("radio", { name: "Liberal" }));
    expect(token("pc-fighter").resourceStance).toBe("liberal");
    expect(tactics().getByText(describe_(RESOURCE_STANCES, "liberal"))).toBeTruthy();
  });

  it("says what a new token starts with and why, and Use these for every Goblin sets it and every goblin, in one step", async () => {
    render(<LiveToken id="enemy-goblin-2" />);
    // Goblin 2 is Basic melee; with no default of its own, a goblin starts as Basic ranged, from its Shortbow.
    expect(tactics().getByText("A new Imported Goblin Stand-in starts as Basic ranged, Balanced (chosen from its attacks).")).toBeTruthy();
    useEncounterStore.setState({ undoStack: [] });
    await userEvent.click(tactics().getByRole("button", { name: "Use these for every Imported Goblin Stand-in" }));
    expect(creature("def-goblin").defaultTactics).toBe("basic-melee");
    expect([token("enemy-goblin-1").tacticsProfile, token("enemy-goblin-2").tacticsProfile]).toEqual(["basic-melee", "basic-melee"]);
    expect(store().undoStack).toHaveLength(1);
    expect(tactics().getByText("A new Imported Goblin Stand-in starts as Basic melee, Balanced.")).toBeTruthy();
    expect(tactics().queryByRole("button", { name: /^Use these for every/ })).toBeNull();
  });

  it("names an SRD monster's own default as the SRD's", async () => {
    await store().addSrdMonster("srd:monster:knight", "party");
    const knight = store().encounter.combatants.at(-1)!;
    render(<LiveToken id={knight.id} />);
    expect(await tactics().findByText("A new Knight starts as Defender, Balanced (the SRD's choice).")).toBeTruthy();
    expect(tactics().queryByRole("button", { name: /^Use these for every/ })).toBeNull();
  });

  it("makes target priority one choice, picking neither when both were set, and keeps Protect it apart", async () => {
    patchToken("enemy-goblin-2", { tags: ["high-priority", "low-priority", "protected"] });
    render(<LiveToken id="enemy-goblin-2" />);
    const priority = () => within(tactics().getByRole("radiogroup", { name: "Enemies target it" }));
    expect(priority().getAllByRole("radio").map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "false"]);
    expect(tactics().getByText(/pick one/)).toBeTruthy();
    await userEvent.click(priority().getByRole("radio", { name: "Last" }));
    expect(token("enemy-goblin-2").tags).toEqual(["protected", "low-priority"]);
    expect(screen.getByRole("button", { name: /^Tactics/ }).textContent).toContain("targeted last · protected");
    await userEvent.click(priority().getByRole("radio", { name: "First" }));
    expect(token("enemy-goblin-2").tags).toEqual(["protected", "high-priority"]);
    await userEvent.click(tactics().getByLabelText("Protect it"));
    expect(token("enemy-goblin-2").tags).toEqual(["high-priority"]);
    await userEvent.click(priority().getByRole("radio", { name: "Normally" }));
    expect(token("enemy-goblin-2").tags).toBeUndefined();
  });

  it("lists what the AI will use by the Abilities dots, each name opening that ability", async () => {
    const onOpenAbility = vi.fn();
    render(<LiveToken id="pc-fighter" onOpenAbility={onOpenAbility} />);
    const uses = within(tactics().getByRole("list"));
    expect(uses.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Longsword, Second Wind (bonus action)",
      "Action Surge: The AI never switches it on by itself: it only takes ones that cost a bonus action, and reactions. Use it by hand in manual play."
    ]);
    expect(uses.getAllByRole("img").map((dot) => dot.getAttribute("data-automation"))).toEqual(["simulated", "partial"]);
    await userEvent.click(uses.getByRole("button", { name: "Longsword" }));
    const ref = onOpenAbility.mock.calls[0]![0] as AbilityRef;
    expect((findAbility(creature("def-fighter"), ref) as { name: string }).name).toBe("Longsword");
  });

  it("opens a name in the Abilities tab's editor, once", async () => {
    useEncounterStore.setState({ selectedCombatantId: "pc-fighter", undoStack: [] });
    const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;
    render(<ActorSheet compendium={compendium} onClose={() => undefined} />);
    await userEvent.click(screen.getByRole("tab", { name: "Token" }));
    await userEvent.click(within(screen.getByRole("region", { name: "Tactics" })).getByRole("button", { name: "Longsword" }));
    expect(screen.getByRole("tab", { name: "Abilities" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("region", { name: "Edit Longsword" })).toBeTruthy();
    // Back on Abilities later, it's the list again.
    await userEvent.click(screen.getByRole("tab", { name: "Stats" }));
    await userEvent.click(screen.getByRole("tab", { name: "Abilities" }));
    expect(screen.queryByRole("region", { name: "Edit Longsword" })).toBeNull();
  });
});
