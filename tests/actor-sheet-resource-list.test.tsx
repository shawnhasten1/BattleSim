// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CombatantState, CreatureDefinition } from "@/engine";
import { loadSrdMonster } from "@/data/srd/monsters";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import { useEncounterStore } from "@/store/encounter-store";

/** The actor sheet plan's Phase 2: one list for every resource, at the top of the Abilities tab. */

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
const fighter = () => store().encounter.definitions.find((definition) => definition.id === "def-fighter")!;
const token = () => store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!;

function LiveTab() {
  const encounter = useEncounterStore((s) => s.encounter);
  return <ActionsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />;
}

function patchFighter(patch: Partial<CreatureDefinition>, tokenPatch: Partial<CombatantState> = {}) {
  useEncounterStore.setState((state) => ({
    encounter: {
      ...state.encounter,
      definitions: state.encounter.definitions.map((definition) => (definition.id === "def-fighter" ? { ...definition, ...patch } : definition)),
      combatants: state.encounter.combatants.map((combatant) => (combatant.id === "pc-fighter" ? { ...combatant, ...tokenPatch } : combatant))
    },
    undoStack: []
  }));
}

const head = () => within(screen.getByRole("region", { name: "Resources" })).getByRole("button", { name: /^Resources/ });
async function openList() {
  if (head().getAttribute("aria-expanded") !== "true") await userEvent.click(head());
  return within(screen.getByRole("group", { name: "Resource sizes" }));
}
async function retype(box: HTMLElement, text: string) {
  await userEvent.clear(box);
  await userEvent.type(box, text);
}

/** The Unicorn's Healing Touch (3/Day) on the fighter, as a library add would put it. */
async function withHealingTouch() {
  const unicorn = (await loadSrdMonster("srd:monster:unicorn"))!;
  const touch = unicorn.actions.find((action) => action.name === "Healing Touch")!;
  patchFighter({ actions: [...fighter().actions, touch], resources: { ...fighter().resources, "usage:healing-touch": 3 } }, { resources: { ...token().resources, "usage:healing-touch": 3 } });
}

describe("the resource list", { timeout: 20000 }, () => {
  it("names its columns for this token and the creature, and remembers being open", async () => {
    const view = render(<LiveTab />);
    await openList();
    expect(screen.getByText("Left · Fighter")).toBeTruthy();
    expect(screen.getByText(`Full · every ${fighter().name}`)).toBeTruthy();
    view.unmount();
    render(<LiveTab />);
    expect(head().getAttribute("aria-expanded")).toBe("true");
  });

  it("spends and restores what's left with its dots, and readies a recharge", async () => {
    const dragon = (await loadSrdMonster("srd:monster:adult-red-dragon"))!;
    const breath = dragon.actions.find((action) => action.name === "Fire Breath")!;
    patchFighter({ actions: [...fighter().actions, breath], resources: { ...fighter().resources, "usage:fire-breath": 1 } }, { resources: { ...token().resources, "usage:fire-breath": 0 } });
    render(<LiveTab />);
    const list = await openList();
    await userEvent.click(list.getByRole("button", { name: "Second Wind: 1 left" }));
    expect(token().resources!["second-wind"]).toBe(0);
    await userEvent.click(list.getByRole("button", { name: "Second Wind: 1 left" }));
    expect(token().resources!["second-wind"]).toBe(1);
    await userEvent.click(list.getByRole("button", { name: "Fire Breath: recharging" }));
    expect(token().resources!["usage:fire-breath"]).toBe(1);
    expect(list.getByRole("button", { name: "Fire Breath: ready" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("sizes uses so the ability's editor shows the same number, and the other way round", async () => {
    await withHealingTouch();
    render(<LiveTab />);
    let list = await openList();
    await retype(list.getByLabelText("Healing Touch full"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Edit Healing Touch" }));
    await userEvent.click(screen.getByRole("button", { name: /^Use & cost/ }));
    const uses = screen.getByLabelText("Uses per encounter") as HTMLInputElement;
    expect(uses.value).toBe("2");
    await retype(uses, "4");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    list = await openList();
    expect((list.getByLabelText("Healing Touch full") as HTMLInputElement).value).toBe("4");
  });

  it("sizes a weapon's charges so the weapon's editor shows the same number", async () => {
    store().attachSrdWeapon("def-fighter", "srd:weapon:fear-sword");
    render(<LiveTab />);
    const list = await openList();
    await retype(list.getByLabelText("The Fear Sword charges full"), "3");
    expect(fighter().weapons!.find((weapon) => weapon.charges)!.charges!.max).toBe(3);
    await userEvent.click(screen.getByRole("button", { name: "Edit The Fear Sword" }));
    await userEvent.click(screen.getByRole("button", { name: /^Use & cost/ }));
    expect((screen.getByLabelText("Charges") as HTMLInputElement).value).toBe("3");
  });

  it("adds a spell slot level, offers the ones its spells need, and takes one away", async () => {
    store().attachSrdSpell("def-fighter", "srd:spell:fireball");
    render(<LiveTab />);
    let list = await openList();
    expect(list.getByText("None yet: Fireball needs them.")).toBeTruthy();
    await retype(list.getByLabelText("3rd-level spell slots full"), "2");
    expect([fighter().resources!["slot-3"], token().resources!["slot-3"]]).toEqual([2, 2]);
    await userEvent.selectOptions(screen.getByLabelText("Add a spell slot level"), "1");
    expect([fighter().resources!["slot-1"], token().resources!["slot-1"]]).toEqual([1, 1]);
    list = await openList();
    await userEvent.click(list.getByRole("button", { name: "Remove 1st-level spell slots" }));
    expect(fighter().resources!["slot-1"]).toBeUndefined();
  });

  it("adds a pool by name, which an ability then picks and spends", async () => {
    render(<LiveTab />);
    await openList();
    await userEvent.click(screen.getByRole("button", { name: "+ Add a pool" }));
    await userEvent.type(screen.getByLabelText("New pool name"), "Superiority dice");
    await retype(screen.getByLabelText("New pool size"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Add pool" }));
    expect([fighter().resources!["superiority-dice"], token().resources!["superiority-dice"]]).toEqual([4, 4]);
    expect(within(screen.getByRole("group", { name: "Not spent by any ability yet" })).getByText("Superiority dice")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Edit Longsword" }));
    await userEvent.click(screen.getByRole("button", { name: /^Use & cost/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Pool" }));
    await userEvent.selectOptions(screen.getByLabelText("Spends from"), "superiority-dice");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const list = await openList();
    expect(list.getByText("Superiority dice")).toBeTruthy();
    expect(list.getByText("spent by Longsword")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Not spent by any ability yet" })).toBeNull();
  });

  it("shows on a creature with no resources yet, so it can be given its first", async () => {
    function GoblinTab() {
      const encounter = useEncounterStore((s) => s.encounter);
      return <ActionsTab combatant={encounter.combatants.find((c) => c.id === "enemy-goblin-1")!} definition={encounter.definitions.find((d) => d.id === "def-goblin")!} />;
    }
    render(<GoblinTab />);
    expect(head().textContent).toBe("Resourcesnone yet");
    await userEvent.click(head());
    expect(screen.getByRole("button", { name: "+ Add a pool" })).toBeTruthy();
  });

  it("lists what nothing spends apart, to remove, and refills a token in one undo step", async () => {
    patchFighter({ resources: { ...fighter().resources, "usage:gone": 1 } }, { resources: { "second-wind": 0, "action-surge": 0 } });
    render(<LiveTab />);
    await openList();
    const unused = within(screen.getByRole("group", { name: "Not spent by any ability yet" }));
    await userEvent.click(unused.getByRole("button", { name: "Remove Gone" }));
    expect(fighter().resources!["usage:gone"]).toBeUndefined();
    const before = store().undoStack.length;
    await userEvent.click(screen.getByRole("button", { name: "Refill all" }));
    expect([token().resources!["second-wind"], token().resources!["action-surge"]]).toEqual([1, 1]);
    expect(store().undoStack).toHaveLength(before + 1);
  });
});
