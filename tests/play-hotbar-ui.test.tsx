// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleEncounter, type EncounterSnapshot, type PlayControl, type Point } from "@/engine";
import { findSrdFeature } from "@/data/srd";
import { PlayAimMarks, PlayAimTooltip } from "@/components/play/PlayAimLayer";
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
  useEncounterStore.setState({ encounter, log: [], undoStack: [], redoStack: [], undoLogLengths: [], redoLogTails: [] });
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
      <svg aria-label="Marks">{aim ? <PlayAimMarks view={aim} /> : null}</svg>
      {aim ? <PlayAimTooltip view={aim} cellSize={50} /> : null}
      <PlayOverlay move={move} />
    </>
  );
}

describe("the hotbar", () => {
  it("shows the turn's abilities by tab; a number key arms one, Esc puts it away, Enter ends the turn", async () => {
    load();
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    render(<Screen />);
    const bar = screen.getByRole("region", { name: "Fighter's turn" });
    const tabs = within(bar).getByRole("tablist", { name: "Abilities" });
    expect(within(tabs).getAllByRole("tab").map((entry) => entry.textContent)).toEqual(["Attacks2", "Spells", "Bonus", "Features2", "Common5"]);
    const panel = within(bar).getByRole("tabpanel", { name: "Attacks" });
    expect(within(panel).getAllByRole("button").map((entry) => entry.textContent)).toEqual(["1Extra Attack2 attacks", "2Longsword"]);

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
});
