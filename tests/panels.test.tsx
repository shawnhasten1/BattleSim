// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEncounterStore } from "../src/store/encounter-store";
import { useSceneInteraction } from "../src/hooks/useSceneInteraction";
import { CombatPanel } from "../src/components/sidebar/CombatPanel";
import { ActorsPanel } from "../src/components/sidebar/ActorsPanel";
import { ScenePanel } from "../src/components/sidebar/ScenePanel";

// The store is a module singleton seeded from the sample encounter; snap it
// back to that between tests so mutations from one don't leak into the next.
const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
});
afterEach(() => {
  document.body.innerHTML = "";
});

function ActorsHarness(props: { onOpenCreate: () => void }) {
  return <ActorsPanel {...props} />;
}

function SceneHarness({ onOpenConfig }: { onOpenConfig: () => void }) {
  const isPanningRef = useRef(false);
  const scene = useSceneInteraction({ isPanning: false, isPanningRef });
  return <ScenePanel scene={scene} onOpenConfig={onOpenConfig} />;
}

describe("CombatPanel", () => {
  it("lists the sample combatants and the run controls", () => {
    render(<CombatPanel />);
    expect(screen.getByText("Initiative Order")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Auto Run/ })).toBeTruthy();
    expect(screen.getByText("Fighter")).toBeTruthy();
    expect(screen.getByText("Goblin 1")).toBeTruthy();
  });

  it("rolls initiative through the store when the button is clicked", async () => {
    render(<CombatPanel />);
    expect(useEncounterStore.getState().encounter.round).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: /Initiative/ }));
    expect(useEncounterStore.getState().encounter.combatants.every((c) => typeof c.initiative === "number")).toBe(true);
  });
});

describe("ActorsPanel", () => {
  it("renders the create button, the search and the directory's groups", () => {
    render(<ActorsHarness onOpenCreate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Create Token/ })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search actors" })).toBeTruthy();
    expect(screen.getByText(/tokens on the map/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "My actors" })).toBeTruthy();
    // The sample's creatures aren't in a library: they're this scene's own.
    expect(within(screen.getByRole("list", { name: "This scene only" })).getByText("Test Fighter")).toBeTruthy();
  });

  it("has no selected-token card: the token's own menus do that", () => {
    render(<ActorsHarness onOpenCreate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Sheet$/ })).toBeNull();
    expect(screen.queryByText("Select a token on the map, or create one.")).toBeNull();
  });
});

describe("ScenePanel", () => {
  it("renders the scene sections and opens the config modal", async () => {
    const onOpenConfig = vi.fn();
    render(<SceneHarness onOpenConfig={onOpenConfig} />);
    expect(screen.getByText("Background")).toBeTruthy();
    expect(screen.getByText(/Layers/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Configure/ }));
    expect(onOpenConfig).toHaveBeenCalled();
  });

  it("lists drawn walls and terrain from the sample map", () => {
    render(<SceneHarness onOpenConfig={vi.fn()} />);
    expect(screen.getByText(/Wall 1/)).toBeTruthy();
    expect(screen.getByText(/Rubble/)).toBeTruthy();
  });
});
