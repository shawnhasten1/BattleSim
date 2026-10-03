// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleEncounter } from "@/engine";
import { CombatPanel } from "@/components/sidebar/CombatPanel";
import { PlayOverlay } from "@/components/play/PlayOverlay";
import { describeQuestion } from "@/lib/play/questions";
import { useEncounterStore } from "@/store/encounter-store";

/** Play's UI (PLAY_MODE_PLAN.md Phase 3): the setup, the turn bar and banner, the playback, a question, the end. */
const pristine = useEncounterStore.getState();
const store = () => useEncounterStore.getState();
const INITIATIVE: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15, "enemy-goblin-1": 12, "enemy-goblin-2": 8 };

beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
  const encounter = structuredClone(sampleEncounter);
  encounter.map.walls = [];
  encounter.combatants = encounter.combatants.map((combatant) => ({ ...combatant, initiative: INITIATIVE[combatant.id] }));
  useEncounterStore.setState({ encounter, log: [] });
});
afterEach(() => {
  cleanup();
  useEncounterStore.setState(pristine, true);
});

function Screen() {
  return (
    <>
      <CombatPanel />
      <div aria-label="Battlemap scene">
        {useEncounterStore((state) => state.play) ? <PlayOverlay /> : null}
      </div>
    </>
  );
}

describe("starting a fight in Play", () => {
  it("asks who plays each side in the scene, then starts on the first turn", async () => {
    render(<Screen />);
    await userEvent.click(screen.getByRole("button", { name: /^Play$/ }));
    const setup = screen.getByRole("region", { name: "Play setup" });
    expect(within(setup).getByRole("radiogroup", { name: "Who plays the party" })).toBeTruthy();
    expect(within(setup).getByRole("radiogroup", { name: "Who plays the enemies" })).toBeTruthy();
    expect(within(setup).queryByRole("radiogroup", { name: "Who plays the neutral" })).toBeNull();
    await userEvent.click(within(within(setup).getByRole("radiogroup", { name: "How the AI's turns play out" })).getByRole("radio", { name: "Instant" }));
    await userEvent.click(within(setup).getByRole("button", { name: "Start" }));
    expect(store().play?.control.factions).toEqual({ party: "human", enemy: "ai" });
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-fighter" });
    // The turn bar, and the turn's banner over the map.
    const bar = screen.getByRole("navigation", { name: "Turn order" });
    expect(within(bar).getAllByRole("button").map((button) => button.getAttribute("aria-current"))).toEqual(["true", null, null, null]);
    expect(within(bar).getAllByText("YOU")).toHaveLength(2);
    expect(within(bar).getAllByText("AI")).toHaveLength(2);
    // Step and Auto Run make way for the fight's own controls.
    expect(screen.queryByRole("button", { name: /^Step$/ })).toBeNull();
    expect(screen.getByRole("region", { name: "Play" })).toBeTruthy();
  });
});

describe("a fight in progress", () => {
  it("End turn lets the AI's turns play back, with Skip; then it's the next person's turn", async () => {
    store().startPlay({ control: { factions: { party: "human", enemy: "ai" } }, playbackSpeed: 0 });
    render(<Screen />);
    const banner = () => screen.getByLabelText("Battlemap scene");
    await userEvent.click(within(banner()).getByRole("button", { name: "End turn" }));
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-archer" });
    act(() => store().setPlaybackSpeed(1));
    await userEvent.click(within(banner()).getByRole("button", { name: "End turn" }));
    // The goblins' turns: played back, one at a time.
    expect(store().play?.playback).toBeDefined();
    expect(within(banner()).getByText("Goblin 1's turn")).toBeTruthy();
    await userEvent.click(within(banner()).getByRole("button", { name: "Skip" }));
    expect(store().play?.playback).toBeUndefined();
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-fighter" });
    expect(within(banner()).getByText("Your turn:").parentElement?.textContent).toContain("Fighter");
  });

  it("hands one creature to the AI from its row", async () => {
    store().startPlay({ control: { factions: { party: "human", enemy: "ai" } }, playbackSpeed: 0 });
    render(<Screen />);
    await userEvent.click(screen.getByRole("button", { name: "Archer: played by you" }));
    expect(store().play?.control.tokens).toEqual({ "pc-archer": "ai" });
    expect(screen.getByRole("button", { name: "Archer: played by the AI" })).toBeTruthy();
  });

  it("a question waits on its card, and its answer finishes the step", async () => {
    const encounter = store().encounter;
    encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!.position = { x: 6, y: 4 };
    encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.position = { x: 5, y: 4 };
    store().startPlay({ control: { factions: { party: "human", enemy: "human" } }, playbackSpeed: 0 });
    store().playCommand({ kind: "move", actorId: "pc-fighter", waypoints: [{ x: 2, y: 4 }] });
    render(<Screen />);
    const card = screen.getByRole("dialog", { name: "Goblin 1 can choose" });
    expect(within(card).getByText("Fighter is leaving Goblin 1's reach.")).toBeTruthy();
    expect(within(card).getByText("Make an opportunity attack?")).toBeTruthy();
    await userEvent.click(within(card).getByRole("button", { name: "Don't" }));
    expect(screen.queryByRole("dialog", { name: "Goblin 1 can choose" })).toBeNull();
    expect(store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.position).toEqual({ x: 2, y: 4 });
  });

  it("says who won at the end, and Reset to setup puts the board back", async () => {
    store().startPlay({ control: { factions: { party: "human", enemy: "human" } }, playbackSpeed: 0 });
    for (let turn = 0; turn < 300 && store().play?.status.kind !== "over"; turn += 1) {
      const status = store().play!.status;
      if (store().play?.pending) store().answerPrompt({ kind: "reaction", actionId: null });
      else if (status.kind === "your-turn") store().playCommand({ kind: "ai-turn", actorId: status.actorId });
      else store().continuePlay();
    }
    render(<Screen />);
    const card = screen.getByRole("dialog", { name: "The fight is over" });
    expect(within(card).getByText(/won in round \d+|Nobody is left standing/)).toBeTruthy();
    await userEvent.click(within(card).getByRole("button", { name: "Reset to setup" }));
    expect(store().play).toBeNull();
    expect(store().encounter.round).toBe(0);
  });
});

describe("the words of a question", () => {
  it("Legendary Resistance: the save, the roll, and the uses left", () => {
    const text = describeQuestion({
      kind: "legendary-resistance", key: "0:legendary-resistance:enemy-goblin-1", combatantId: "enemy-goblin-1", feature: "Legendary Resistance (3/Day)",
      ability: "wis", dc: 15, rolled: 9, usesLeft: 3, against: "Hold Person", aiChoice: true
    }, sampleEncounter);
    expect(text.title).toBe("Goblin 1 failed a DC 15 Wisdom save against Hold Person (rolled 9).");
    expect(text.ask).toBe("Use Legendary Resistance (3/Day) (3 left) to succeed instead?");
    expect(text.options.map((option) => option.label)).toEqual(["Use Legendary Resistance", "Fail the save"]);
  });
});
