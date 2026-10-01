// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuffActionDefinition, CombatantState, CreatureDefinition } from "@/engine";
import { TokenTab } from "@/components/sheet/sheet-tabs/TokenTab";
import { useEncounterStore } from "@/store/encounter-store";

/** The actor sheet plan's Phase 4, driven: the Token tab's name and side, This fight, Appearance, Status & position. */

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
const token = (id = "pc-fighter") => store().encounter.combatants.find((combatant) => combatant.id === id)!;
const creature = (id = "def-fighter") => store().encounter.definitions.find((definition) => definition.id === id)!;

function LiveToken({ id = "pc-fighter" }: { id?: string }) {
  const encounter = useEncounterStore((s) => s.encounter);
  const combatant = encounter.combatants.find((candidate) => candidate.id === id)!;
  return <TokenTab combatant={combatant} definition={encounter.definitions.find((definition) => definition.id === combatant.definitionId)!} />;
}

const mageArmor: BuffActionDefinition = {
  kind: "buff",
  id: "mage-armor",
  name: "Mage Armor",
  actionType: "action",
  range: 5,
  targeting: { target: "single" },
  prepOnly: true,
  appliedCondition: { name: "custom", durationRounds: 100, modifiers: { armorClass: 3 } },
  resourceCost: { resourceId: "slot-1", amount: 1 },
  automationSupport: "full"
};

/** The fighter with a pre-cast buff and a slot for it, a fly speed, and a lair. */
function equipFighter(patch: Partial<CreatureDefinition> = {}, tokenPatch: Partial<CombatantState> = {}) {
  useEncounterStore.setState((state) => ({
    encounter: {
      ...state.encounter,
      definitions: state.encounter.definitions.map((definition) => (definition.id === "def-fighter"
        ? {
            ...definition,
            actions: [...definition.actions, mageArmor],
            resources: { ...definition.resources, "slot-1": 1 },
            movement: { walk: definition.speed, fly: 60 },
            lairActions: [{ ...mageArmor, id: "lair-tremor", name: "Tremor", prepOnly: undefined }],
            ...patch
          }
        : definition)),
      combatants: state.encounter.combatants.map((combatant) => (combatant.id === "pc-fighter"
        ? { ...combatant, resources: { ...combatant.resources, "slot-1": 1 }, ...tokenPatch }
        : combatant))
    },
    undoStack: []
  }));
}

const section = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title.replace(/[&]/g, "\\$&")}`) });
const fight = () => within(screen.getByRole("region", { name: "This fight" }));

describe("the Token tab", { timeout: 20000 }, () => {
  it("opens with This fight and Tactics, and remembers which sections are open", async () => {
    const view = render(<LiveToken />);
    expect(["This fight", "Tactics", "Appearance", "Status & position"].map((title) => section(title).getAttribute("aria-expanded")))
      .toEqual(["true", "true", "false", "false"]);
    await userEvent.click(section("Tactics"));
    await userEvent.click(section("Appearance"));
    view.unmount();
    render(<LiveToken />);
    expect(["This fight", "Tactics", "Appearance"].map((title) => section(title).getAttribute("aria-expanded"))).toEqual(["true", "false", "true"]);
  });

  it("names the token and picks its side", async () => {
    render(<LiveToken />);
    await userEvent.type(screen.getByLabelText("Token name"), " the Bold");
    expect(token().displayName).toBe("Fighter the Bold");
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Faction" })).getByRole("radio", { name: "Neutral" }));
    expect(token().faction).toBe("neutral");
  });

  it("sets each part of This fight through the store action its shortcut uses", async () => {
    equipFighter();
    const actions = ["setArrivesRound", "toggleCombatantSurprised", "togglePrepBuff", "setAltitude", "setInLair"] as const;
    const spies = Object.fromEntries(actions.map((name) => {
      const spy = vi.fn(store()[name] as (...args: unknown[]) => void);
      useEncounterStore.setState({ [name]: spy });
      return [name, spy];
    }));
    render(<LiveToken />);

    await userEvent.click(fight().getByRole("radio", { name: "On a later round" }));
    expect(spies.setArrivesRound).toHaveBeenLastCalledWith(["pc-fighter"], 2);
    expect([token().state, token().arrivesRound]).toEqual(["reserve", 2]);
    await userEvent.clear(fight().getByLabelText("Arrives on round"));
    await userEvent.type(fight().getByLabelText("Arrives on round"), "3");
    expect(spies.setArrivesRound).toHaveBeenLastCalledWith(["pc-fighter"], 3);
    await userEvent.click(fight().getByRole("radio", { name: "On the board" }));
    expect(spies.setArrivesRound).toHaveBeenLastCalledWith(["pc-fighter"], undefined);
    expect([token().state, token().arrivesRound]).toEqual(["active", undefined]);

    await userEvent.click(fight().getByLabelText("Surprised"));
    expect(spies.toggleCombatantSurprised).toHaveBeenCalledWith("pc-fighter");
    expect(token().conditions?.map((condition) => condition.name)).toEqual(["surprised"]);

    await userEvent.click(fight().getByRole("checkbox", { name: "Mage Armor" }));
    expect(spies.togglePrepBuff).toHaveBeenCalledWith("pc-fighter", "mage-armor");
    expect(token().resources?.["slot-1"]).toBe(0);

    await userEvent.click(fight().getByRole("button", { name: "30" }));
    expect(spies.setAltitude).toHaveBeenLastCalledWith(["pc-fighter"], 30);
    expect(token().altitude).toBe(30);

    await userEvent.click(fight().getByLabelText("In its lair"));
    expect(spies.setInLair).toHaveBeenCalledWith(["pc-fighter"], true);
    expect(token().inLair).toBe(true);
    expect(section("This fight").textContent).toContain("on the board · surprised · Mage Armor up · 30 ft in the air · in its lair");
  });

  it("shows a row only where it applies", () => {
    render(<LiveToken id="enemy-goblin-2" />);
    expect(fight().getByRole("radiogroup", { name: "Enters" })).toBeTruthy();
    expect(fight().getByLabelText("Surprised")).toBeTruthy();
    for (const row of ["Already up", "Altitude", "In its lair"]) expect(fight().queryByText(row)).toBeNull();
    cleanup();
    // In the air without a fly speed: Altitude shows, to bring it down.
    useEncounterStore.setState((state) => ({
      encounter: { ...state.encounter, combatants: state.encounter.combatants.map((c) => (c.id === "enemy-goblin-2" ? { ...c, altitude: 20 } : c)) }
    }));
    render(<LiveToken id="enemy-goblin-2" />);
    expect((fight().getByLabelText("Altitude in feet") as HTMLInputElement).value).toBe("20");
    expect(fight().getByText(/No fly speed/)).toBeTruthy();
  });

  it("disables entering, surprise and what's already up once the fight is under way, and says why", () => {
    equipFighter();
    useEncounterStore.setState((state) => ({ encounter: { ...state.encounter, round: 1 } }));
    render(<LiveToken />);
    for (const radio of fight().getAllByRole("radio")) expect((radio as HTMLButtonElement).disabled).toBe(true);
    expect((fight().getByLabelText("Surprised") as HTMLInputElement).disabled).toBe(true);
    expect((fight().getByRole("checkbox", { name: "Mage Armor" }) as HTMLInputElement).disabled).toBe(true);
    expect((fight().getByLabelText("Altitude in feet") as HTMLInputElement).disabled).toBe(false);
    expect((fight().getByLabelText("In its lair") as HTMLInputElement).disabled).toBe(false);
    expect(fight().getByText(/The fight is under way/)).toBeTruthy();
  });

  it("puts an image on this token or on every token of its creature; scale and glow come with one", async () => {
    render(<LiveToken id="enemy-goblin-2" />);
    await userEvent.click(section("Appearance"));
    const appearance = () => within(screen.getByRole("region", { name: "Appearance" }));
    expect(appearance().queryByLabelText("Image scale")).toBeNull();
    expect(appearance().getByText("No image: it shows its initials.")).toBeTruthy();
    const upload = () => appearance().getByLabelText(/(Upload|Replace) image/) as HTMLInputElement;
    const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });

    // The creature's first: every goblin shows it.
    expect(appearance().getByRole("radio", { name: "Every Imported Goblin Stand-in" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.upload(upload(), png("goblin.png"));
    await waitFor(() => expect(creature("def-goblin").tokenVisuals?.imageUrl).toMatch(/^data:image\/png/));
    expect(token("enemy-goblin-2").tokenVisuals?.imageUrl).toBeUndefined();
    expect(appearance().getByText(/Every Imported Goblin Stand-in shows this image/)).toBeTruthy();

    // Then this token's own, in place of it.
    await userEvent.click(appearance().getByRole("radio", { name: "This token" }));
    await userEvent.upload(upload(), png("boss.png"));
    await waitFor(() => expect(token("enemy-goblin-2").tokenVisuals?.imageUrl).toMatch(/^data:image\/png/));
    expect(appearance().getByText(/This token has its own image, in place of the one every Imported Goblin Stand-in has/)).toBeTruthy();

    await userEvent.click(appearance().getByLabelText("Glow"));
    expect(token("enemy-goblin-2").tokenVisuals?.tint).toBeTruthy();
    await userEvent.clear(appearance().getByLabelText("Image scale"));
    await userEvent.type(appearance().getByLabelText("Image scale"), "1.25");
    expect(token("enemy-goblin-2").tokenVisuals?.scale).toBe(1.25);

    await userEvent.click(appearance().getByRole("button", { name: "Clear" }));
    expect(token("enemy-goblin-2").tokenVisuals?.imageUrl).toBeUndefined();
    expect(creature("def-goblin").tokenVisuals?.imageUrl).toBeTruthy();
    await userEvent.click(appearance().getByRole("radio", { name: "Every Imported Goblin Stand-in" }));
    await userEvent.click(appearance().getByRole("button", { name: "Clear" }));
    expect(creature("def-goblin").tokenVisuals?.imageUrl).toBeUndefined();
    expect(appearance().queryByLabelText("Image scale")).toBeNull();
  });

  it("sets a border, resets it to white, and shows a nameplate", async () => {
    render(<LiveToken id="enemy-goblin-2" />);
    await userEvent.click(section("Appearance"));
    expect(screen.getByText("white")).toBeTruthy();
    store().updateCombatantVisuals("enemy-goblin-2", { borderColor: "#aa0000" });
    await userEvent.click(await screen.findByRole("button", { name: "Reset" }));
    expect(token("enemy-goblin-2").tokenVisuals?.borderColor).toBeUndefined();
    await userEvent.click(screen.getByLabelText("Nameplate"));
    expect(token("enemy-goblin-2").tokenVisuals?.showNameplate).toBe(true);
    expect(section("Appearance").textContent).toContain("initials · white border · nameplate");
  });

  it("overrides its state and moves it a square at a time; a reinforcement's state waits for it", async () => {
    render(<LiveToken id="enemy-goblin-2" />);
    await userEvent.click(section("Status & position"));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "State" }), "fled");
    expect(token("enemy-goblin-2").state).toBe("fled");
    await userEvent.clear(screen.getByLabelText("X"));
    await userEvent.type(screen.getByLabelText("X"), "3");
    expect(token("enemy-goblin-2").position).toEqual({ x: 3, y: 5 });
    expect(section("Status & position").textContent).toContain("Fled · square 3, 5");

    store().updateCombatant("enemy-goblin-2", { state: "active" });
    store().setArrivesRound(["enemy-goblin-2"], 2);
    await waitFor(() => expect((screen.getByRole("combobox", { name: "State" }) as HTMLSelectElement).disabled).toBe(true));
    expect(screen.getByText(/isn.t on the board until round 2/)).toBeTruthy();
  });
});
