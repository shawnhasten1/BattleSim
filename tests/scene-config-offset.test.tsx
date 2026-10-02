// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MAP_IMAGE_SETTINGS, sampleEncounter, type EncounterSnapshot } from "@/engine";
import { deriveSceneMetrics } from "@/components/scene/metrics";
import { SceneConfigModal } from "@/components/modals/SceneConfigModal";
import { useEncounterStore } from "@/store/encounter-store";

const pristine = useEncounterStore.getState();
const store = () => useEncounterStore.getState();

beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
  // A 30 × 20 Inkarnate export at 100 px per square, pinned.
  const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
  encounter.map.grid = { ...encounter.map.grid, width: 30, height: 20, squareSizePx: 44 };
  encounter.map.image = { ...DEFAULT_MAP_IMAGE_SETTINGS, naturalWidthPx: 2048, naturalHeightPx: 1365, sourceWidthPx: 3000, sourceHeightPx: 2000, pxPerSquare: 100 };
  useEncounterStore.setState({ encounter, mapImageDataUrl: "data:image/png;base64,AAAA", undoStack: [] });
});
afterEach(() => cleanup());

describe("Scene Config's grid offset", () => {
  it("shifts the grid over the map by what's typed, in the image's own pixels", async () => {
    render(<SceneConfigModal onClose={() => undefined} />);
    const x = screen.getByLabelText("Grid offset X");
    const y = screen.getByLabelText("Grid offset Y");
    expect((x as HTMLInputElement).value).toBe("0");
    await userEvent.clear(x);
    await userEvent.type(x, "50");
    await userEvent.clear(y);
    await userEvent.type(y, "-25");
    expect(store().encounter.map.image).toMatchObject({ originX: 50, originY: -25 });
    // Half a square right and a quarter up: the image moves the other way under the grid.
    const box = deriveSceneMetrics(store().encounter.map).imageBox;
    expect(box.left).toBe(-22);
    expect(box.top).toBe(11);
    // The image is still read as 30 × 20; a partial square of offset isn't a refit to suggest.
    expect(screen.getByRole("group", { name: "Grid from the image" }).textContent).toContain("30 × 20 squares");
    expect(screen.queryByRole("button", { name: /Fit grid to cover the image/ })).toBeNull();
  });

  it("steps with the arrow keys, Shift for 10", async () => {
    render(<SceneConfigModal onClose={() => undefined} />);
    const x = screen.getByLabelText("Grid offset X");
    await userEvent.click(x);
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{Shift>}{ArrowUp}{/Shift}{ArrowDown}");
    expect(store().encounter.map.image?.originX).toBe(11);
  });

  it("keeps a half-typed value in the box without committing it", async () => {
    render(<SceneConfigModal onClose={() => undefined} />);
    const x = screen.getByLabelText("Grid offset X") as HTMLInputElement;
    await userEvent.clear(x);
    await userEvent.type(x, "-");
    expect(x.value).toBe("-");
    expect(store().encounter.map.image?.originX ?? 0).toBe(0);
  });
});
