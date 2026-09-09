// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEncounterStore } from "../src/store/encounter-store";
import { useCompendium } from "../src/hooks/useCompendium";
import { useSceneInteraction } from "../src/hooks/useSceneInteraction";
import { CombatPanel } from "../src/components/sidebar/CombatPanel";
import { ActorsPanel } from "../src/components/sidebar/ActorsPanel";
import { CompendiumPanel } from "../src/components/sidebar/CompendiumPanel";
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

function ActorsHarness(props: { onOpenCreate: () => void; onOpenSheet: () => void }) {
  const compendium = useCompendium();
  return <ActorsPanel compendium={compendium} {...props} />;
}

function CompendiumHarness() {
  return <CompendiumPanel compendium={useCompendium()} />;
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
  it("renders the create button and the actor directory", () => {
    render(<ActorsHarness onOpenCreate={vi.fn()} onOpenSheet={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Create Token/ })).toBeTruthy();
    expect(screen.getByText(/tokens/)).toBeTruthy();
  });

  it("invokes onOpenSheet from the selection actions", async () => {
    const onOpenSheet = vi.fn();
    render(<ActorsHarness onOpenCreate={vi.fn()} onOpenSheet={onOpenSheet} />);
    await userEvent.click(screen.getByRole("button", { name: /Sheet/ }));
    expect(onOpenSheet).toHaveBeenCalled();
  });
});

describe("CompendiumPanel", () => {
  it("renders the category chips and search box", () => {
    render(<CompendiumHarness />);
    expect(screen.getByRole("button", { name: "Creatures" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Spells" })).toBeTruthy();
    expect(screen.getByPlaceholderText(/Search Open5e/)).toBeTruthy();
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
