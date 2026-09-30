// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleEncounter } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { useSceneInteraction } from "@/hooks/useSceneInteraction";
import { LeftToolRail } from "@/components/shell/LeftToolRail";
import { SceneOverlays } from "@/components/scene/SceneOverlays";

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
afterEach(() => {
  document.body.innerHTML = "";
  useEncounterStore.setState(pristine, true);
});

const railProps = { showGrid: true, onToggleGrid: () => {}, showHealthBars: true, onToggleHealthBars: () => {} };

describe("show / hide elevation", () => {
  it("the rail toggle flips like the grid toggle", async () => {
    let shown = true;
    const { rerender } = render(<LeftToolRail {...railProps} showElevation={shown} onToggleElevation={() => { shown = !shown; }} />);
    const button = screen.getByRole("button", { name: /^Hide elevation/ });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(button);
    expect(shown).toBe(false);
    rerender(<LeftToolRail {...railProps} showElevation={shown} onToggleElevation={() => { shown = !shown; }} />);
    expect(screen.getByRole("button", { name: "Show elevation" }).getAttribute("aria-pressed")).toBe("false");
  });

  function Overlays({ showElevation }: { showElevation: boolean }) {
    const scene = useSceneInteraction({ isPanning: false, isPanningRef: { current: false } });
    const map = useEncounterStore((state) => state.encounter.map);
    return <SceneOverlays scene={scene} map={map} gridPixelWidth={400} gridPixelHeight={300} showElevation={showElevation} />;
  }
  const withHeights = () => {
    const encounter = structuredClone(sampleEncounter);
    encounter.map.elevation = { cells: { "3,3": 20 } };
    useEncounterStore.setState({ encounter });
  };

  it("hidden, the map draws no height tint or cliff edges", () => {
    withHeights();
    useEncounterStore.setState({ tool: "select" });
    const { container, rerender } = render(<Overlays showElevation />);
    expect(container.querySelectorAll(".elevation-cell").length).toBe(1);
    expect(container.querySelectorAll(".cliff-edge").length).toBeGreaterThan(0);
    rerender(<Overlays showElevation={false} />);
    expect(container.querySelector(".elevation-layer")).toBeNull();
  });

  it("the Elevation tool still shows heights while hidden, so you never paint blind", () => {
    withHeights();
    useEncounterStore.setState({ tool: "elevation" });
    const { container } = render(<Overlays showElevation={false} />);
    expect(container.querySelectorAll(".elevation-cell").length).toBe(1);
  });
});
