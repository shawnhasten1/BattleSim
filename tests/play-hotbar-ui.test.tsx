// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleEncounter, type EncounterSnapshot, type PlayControl, type Point } from "@/engine";
import { findSrdFeature, findSrdSpell } from "@/data/srd";
import { PlayAimLayer, PlayAimMarks, PlayAimTooltip } from "@/components/play/PlayAimLayer";
import { PlayOverlay } from "@/components/play/PlayOverlay";
import { aimAtCreature, usePlayAimView } from "@/hooks/usePlayAim";
import { usePlayMoveView } from "@/hooks/usePlayMove";
import { useEncounterStore } from "@/store/encounter-store";
import { usePlayUiStore } from "@/store/play-ui-store";

/** The hotbar on screen (PLAY_MODE_PLAN.md Phase 5): tabs, keys, aiming, and a multiattack's swing card. */
const pristine = useEncounterStore.getState();
const pristineUi = usePlayUiStore.getState();
const store = () => useEncounterStore.getState();
const ui = () => usePlayUiStore.getState();
const PARTY: PlayControl = { factions: { party: "human", enemy: "ai" } };
const INITIATIVE: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15, "enemy-goblin-1": 12, "enemy-goblin-2": 8 };

function load(change?: (encounter: EncounterSnapshot) => void) {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = "play-hotbar-ui";
  encounter.map.walls = [];
  const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
  fighter.features = [...(fighter.features ?? []), { ...structuredClone(findSrdFeature("srd:feature:extra-attack")!), id: "f-extra" }];
  encounter.combatants = encounter.combatants.map((combatant) => ({ ...combatant, initiative: INITIATIVE[combatant.id] }));
  change?.(encounter);
  useEncounterStore.setState({ encounter, log: [], undoStack: [], redoStack: [], undoPlay: [], redoPlay: [] });
}

function place(encounter: EncounterSnapshot, id: string, position: Point) {
  encounter.combatants.find((combatant) => combatant.id === id)!.position = position;
}

beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  usePlayUiStore.setState(pristineUi, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  useEncounterStore.setState(pristine, true);
  usePlayUiStore.setState(pristineUi, true);
});

/** The overlay and the aim's marks and tooltip, fed as the scene feeds them. */
function Screen() {
  const move = usePlayMoveView();
  const aim = usePlayAimView();
  return (
    <>
      <svg aria-label="Ground">{aim ? <PlayAimLayer view={aim} /> : null}</svg>
      <svg aria-label="Marks">{aim ? <PlayAimMarks view={aim} /> : null}</svg>
      {aim ? <PlayAimTooltip view={aim} cellSize={50} /> : null}
      <PlayOverlay move={move} aim={aim} />
    </>
  );
}

describe("the hotbar", () => {
  it("shows the turn's abilities by the slot they take, grouped by what they are; a number key arms one, Esc puts it away, Enter ends the turn", async () => {
    load();
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    render(<Screen />);
    const bar = screen.getByRole("region", { name: "Fighter's turn" });
    const tabs = within(bar).getByRole("tablist", { name: "Abilities" });
    expect(within(tabs).getAllByRole("tab").map((entry) => entry.textContent)).toEqual(["Actions8", "Bonus1", "Reactions1"]);
    const panel = within(bar).getByRole("tabpanel", { name: "Actions" });
    // Its groups, labelled, in order; the keys count along them.
    expect(within(panel).getAllByRole("group").map((entry) => entry.getAttribute("aria-label"))).toEqual(["Attacks", "Features", "Common"]);
    expect(within(within(panel).getByRole("group", { name: "Attacks" })).getAllByRole("button").map((entry) => entry.textContent)).toEqual(["1Extra Attack2 attacks", "2Longsword"]);
    expect(within(within(panel).getByRole("group", { name: "Features" })).getAllByRole("button")[0]!.textContent).toMatch(/^3Action Surge.*free$/);
    expect(within(within(panel).getByRole("group", { name: "Common" })).getAllByRole("button")[0]!.textContent).toBe("4Dash");
    // Each button is coloured by what it is and marked with what it takes; so is each tab (HOTBAR_REDESIGN_PLAN.md §2).
    const longsword = within(panel).getByRole("button", { name: "Longsword" });
    expect([longsword.closest("[data-tone]")?.getAttribute("data-tone"), longsword.getAttribute("data-slot")]).toEqual(["attacks", "action"]);
    const surge = within(panel).getByRole("button", { name: /Action Surge/ });
    expect([surge.closest("[data-tone]")?.getAttribute("data-tone"), surge.getAttribute("data-slot")]).toEqual(["features", "free"]);
    expect(within(tabs).getAllByRole("tab").map((entry) => entry.getAttribute("data-slot"))).toEqual(["action", "bonus", "reaction"]);

    // 2 arms the longsword; the hint says what to do.
    await userEvent.keyboard("2");
    expect(ui().armed).toMatchObject({ actionId: "longsword" });
    expect(within(bar).getByRole("button", { name: "Longsword" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(bar).getByText(/^Pick a target for Longsword\. Esc puts it away\.$/)).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    // (The scene's own Esc handler isn't mounted here: the button can put it away too.)
    await userEvent.click(within(bar).getByRole("button", { name: "Longsword" }));
    expect(ui().armed).toBeNull();

    // Enter with nothing armed ends the turn.
    await userEvent.keyboard("{Enter}");
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-archer" });
  });

  it("over a creature while aiming: a ring on those it can be aimed at, and what it would do to the one under the cursor", async () => {
    load((encounter) => place(encounter, "enemy-goblin-1", { x: 2, y: 1 }));
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const { container } = render(<Screen />);
    await userEvent.keyboard("2");
    // The goblin beside the fighter can be hit; the far one is out of reach and gets no ring.
    expect(container.querySelectorAll(".play-target:not(.blocked)")).toHaveLength(1);
    act(() => ui().setHover({ x: 2, y: 1 }));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toMatch(/^Longsword → Goblin 1\d+% to hit · \+\d+ against AC \d+ · [\d.]+ damage on a hit$/);
    act(() => ui().setHover({ x: 8, y: 5 }));
    expect(screen.getByRole("tooltip").getAttribute("data-ok")).toBe("false");
  });

  it("a multiattack's next swing: its card, the attack to swing with, and a creature clicked", async () => {
    load((encounter) => {
      place(encounter, "pc-fighter", { x: 2, y: 1 });
      place(encounter, "enemy-goblin-1", { x: 3, y: 1 });
      place(encounter, "enemy-goblin-2", { x: 3, y: 2 });
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    render(<Screen />);
    await userEvent.keyboard("1");
    act(() => { aimAtCreature("enemy-goblin-1"); });
    const card = screen.getByRole("dialog", { name: "Extra Attack: swing 2 of 2" });
    expect(within(card).getByText(/^Swing 2 of 2/)).toBeTruthy();
    expect(within(card).getByText("Click a creature to swing at it, or a square to step to first.")).toBeTruthy();
    // The hotbar makes way for it.
    expect(screen.queryByRole("region", { name: "Fighter's turn" })).toBeNull();
    act(() => { aimAtCreature("enemy-goblin-2"); });
    expect(screen.queryByRole("dialog", { name: /swing/ })).toBeNull();
    const swings = store().log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-fighter");
    expect(swings.map((entry) => entry.data?.targetId)).toEqual(["enemy-goblin-1", "enemy-goblin-2"]);
  });

  it("Skip this swing passes on it", async () => {
    load((encounter) => {
      place(encounter, "pc-fighter", { x: 2, y: 1 });
      place(encounter, "enemy-goblin-1", { x: 3, y: 1 });
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    render(<Screen />);
    await userEvent.keyboard("1");
    act(() => { aimAtCreature("enemy-goblin-1"); });
    await userEvent.click(screen.getByRole("button", { name: "Skip this swing" }));
    expect(store().log.some((entry) => entry.type === "MultiattackSwingSkipped" && entry.data?.reason === "its controller passed")).toBe(true);
    expect(screen.getByRole("region", { name: "Fighter's turn" })).toBeTruthy();
  });

  it("an area follows the cursor: its squares, the foes it catches with their chances, and a warning for a friend", async () => {
    load((encounter) => {
      const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
      fighter.spells = [structuredClone(findSrdSpell("srd:spell:burning-hands")!)];
      fighter.resources = { ...fighter.resources, "slot-1": 2 };
      encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.resources = { "slot-1": 2 };
      place(encounter, "pc-fighter", { x: 3, y: 3 });
      place(encounter, "enemy-goblin-1", { x: 5, y: 2 });
      place(encounter, "enemy-goblin-2", { x: 5, y: 4 });
      place(encounter, "pc-archer", { x: 6, y: 3 });
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const { container } = render(<Screen />);
    const bar = screen.getByRole("region", { name: "Fighter's turn" });
    await userEvent.click(within(bar).getByRole("tab", { name: /^Actions/ }));
    await userEvent.click(within(bar).getByRole("button", { name: /Burning Hands/ }));
    act(() => ui().setHover({ x: 6, y: 3 }));
    expect(container.querySelectorAll(".play-area").length).toBeGreaterThan(3);
    expect(container.querySelectorAll(".play-caught.foe")).toHaveLength(2);
    expect(container.querySelectorAll(".play-caught.friend")).toHaveLength(1);
    expect(within(bar).getByText(/^Click where to put Burning Hands\. It catches Goblin 1 and Goblin 2\. It will catch Archer too\. Esc puts it away\.$/)).toBeTruthy();
  });

  it("a choice is made from buttons in the hotbar", async () => {
    load((encounter) => {
      const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
      fighter.actions = [...fighter.actions, {
        kind: "summon", id: "call-help", name: "Call for Help", actionType: "action", range: 30, choice: "pick", automationSupport: "full",
        options: [{ id: "one", definitionId: "def-archer", label: "An archer", count: 1 }, { id: "two", definitionId: "def-archer", label: "Two archers", count: 2 }]
      } as never];
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    render(<Screen />);
    const bar = screen.getByRole("region", { name: "Fighter's turn" });
    await userEvent.click(within(bar).getByRole("tab", { name: /^Actions/ }));
    await userEvent.click(within(bar).getByRole("button", { name: /Call for Help/ }));
    const choice = within(bar).getByRole("group", { name: "Call for Help: which" });
    await userEvent.click(within(choice).getByRole("button", { name: "An archer" }));
    expect(store().encounter.combatants.filter((combatant) => combatant.summon?.summonerId === "pc-fighter")).toHaveLength(1);
  });
});
