// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAP_IMAGE_SETTINGS, sampleEncounter, type EncounterSnapshot, type MapImageSettings } from "@/engine";
import { deriveSceneMetrics } from "@/components/scene/metrics";
import { alignedMap, alignmentShift, GridAlignPanel } from "@/components/scene/GridAlign";
import { useEncounterStore } from "@/store/encounter-store";

/** The stored copy "Find the drawn grid" reads: 1024 × 768 with a line every 51.2 px from x 17, y 9 (2 px wide). */
function storedGridLuma() {
  const width = 1024;
  const height = 768;
  const onLine = (at: number, start: number) => ((((at + 0.5 - start) % 51.2) + 51.2) % 51.2) < 2;
  const luma = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) luma[y * width + x] = onLine(x, 17) || onLine(y, 9) ? 50 : 205;
  return { luma, width, height };
}

vi.mock("@/lib/imageResize", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/imageResize")>()),
  readImageLuma: vi.fn(async () => storedGridLuma())
}));

const IMAGE = "data:image/png;base64,AAAA";
const pristine = useEncounterStore.getState();
const store = () => useEncounterStore.getState();

beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
// Unmount, not just clear the page: a mounted panel keeps its window key listener.
afterEach(() => cleanup());

/** A plain 2K export (2048 × 1536, stored as is), unpinned, on a 40 × 30 grid; `placed` puts a wall on it. */
function loadMap(image: Partial<MapImageSettings> = {}, placed = false) {
  const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
  encounter.combatants = [];
  encounter.map.terrain = [];
  encounter.map.walls = placed ? [{ id: "w1", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, blocksMovement: true, blocksSight: true, blocksProjectiles: true }] : [];
  encounter.map.grid = { ...encounter.map.grid, width: 40, height: 30, squareSizePx: 44 };
  encounter.map.canvas = { widthPx: 2048, heightPx: 1536 };
  encounter.map.image = { ...DEFAULT_MAP_IMAGE_SETTINGS, naturalWidthPx: 2048, naturalHeightPx: 1536, sourceWidthPx: 2048, sourceHeightPx: 1536, ...image };
  useEncounterStore.setState({ encounter, mapImageDataUrl: IMAGE, undoStack: [] });
}

function LivePanel() {
  const draft = useEncounterStore((state) => state.gridAlign);
  return draft ? <GridAlignPanel draft={draft} /> : null;
}

async function typePx(value: string) {
  const box = screen.getByLabelText("Image px per square");
  await userEvent.clear(box);
  await userEvent.type(box, value);
}

describe("startGridAlign", () => {
  it("does nothing without a background", () => {
    loadMap();
    useEncounterStore.setState({ mapImageDataUrl: null });
    store().startGridAlign();
    expect(store().gridAlign).toBeNull();
  });

  it("starts a pinned image from its pin", () => {
    loadMap({ pxPerSquare: 51.2, originX: 18, originY: 10 });
    store().startGridAlign();
    expect(store().gridAlign).toMatchObject({ pxPerSquare: 51.2, originX: 18, originY: 10, sourceWidthPx: 2048, sourceHeightPx: 1536 });
  });

  it("starts an unpinned image from where it's drawn, so nothing jumps", () => {
    loadMap({ offsetX: 22, offsetY: -8 });
    store().startGridAlign();
    const box = deriveSceneMetrics(alignedMap(store().encounter.map, store().gridAlign!)).imageBox;
    expect(box.left).toBeCloseTo(22, 6);
    expect(box.top).toBeCloseTo(-8, 6);
    expect(box.width).toBeCloseTo(2048, 6);
  });

  it("ignores a draft left from another scene", () => {
    loadMap();
    store().startGridAlign();
    useEncounterStore.setState({ gridAlign: { ...store().gridAlign!, encounterId: "another-scene" } });
    store().applyGridAlign(true);
    expect(store().gridAlign).toBeNull();
    expect(store().encounter.map.image?.pxPerSquare).toBeUndefined();
    expect(store().undoStack).toHaveLength(0);
  });
});

describe("The Align grid panel", () => {
  it("applies in one undo step: the image pinned at what was set", async () => {
    loadMap();
    store().startGridAlign();
    render(<LivePanel />);
    await typePx("51.2");
    // 2048 × 1536 at 51.2 px is the map's own 40 × 30: nothing to fit.
    expect(screen.getByText("Columns and rows already fit the image: 40 × 30 squares.")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(store().gridAlign).toBeNull();
    expect(store().encounter.map.image).toMatchObject({ pxPerSquare: 51.2, sourceWidthPx: 2048, sourceHeightPx: 1536 });
    expect(store().encounter.map.grid).toMatchObject({ width: 40, height: 30 });
    expect(store().undoStack).toHaveLength(1);
  });

  it("fits the grid by default to a new reading of the image", async () => {
    loadMap();
    store().startGridAlign();
    render(<LivePanel />);
    await typePx("64");
    expect(screen.getByLabelText(/Fit columns and rows to the image: 32 × 24 squares \(now 40 × 30\)/)).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(store().encounter.map.grid).toMatchObject({ width: 32, height: 24 });
  });

  it("cancels without touching the map", async () => {
    loadMap({ offsetX: 22 });
    const before = structuredClone(store().encounter.map);
    store().startGridAlign();
    render(<LivePanel />);
    await typePx("51.2");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store().gridAlign).toBeNull();
    expect(store().encounter.map).toEqual(before);
    expect(store().undoStack).toHaveLength(0);
  });

  it("doesn't fit the grid by default when walls are placed", async () => {
    loadMap({}, true);
    store().startGridAlign();
    render(<LivePanel />);
    await typePx("100");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(store().encounter.map.grid).toMatchObject({ width: 40, height: 30 });
    expect(store().encounter.map.image?.pxPerSquare).toBe(100);
  });

  it("shifts the grid with the arrow keys and resizes it with + and −", () => {
    loadMap({ pxPerSquare: 51.2, originX: 18, originY: 10 });
    store().startGridAlign();
    render(<LivePanel />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(store().gridAlign).toMatchObject({ originX: 19, originY: 10 });
    fireEvent.keyDown(window, { key: "ArrowDown", shiftKey: true });
    expect(store().gridAlign).toMatchObject({ originX: 19, originY: 20 });
    fireEvent.keyDown(window, { key: "+" });
    expect(store().gridAlign?.pxPerSquare).toBeCloseTo(51.3, 9);
    fireEvent.keyDown(window, { key: "-" });
    fireEvent.keyDown(window, { key: "-" });
    expect(store().gridAlign?.pxPerSquare).toBeCloseTo(51.1, 9);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(store().gridAlign).toBeNull();
    expect(store().encounter.map.image).toMatchObject({ originX: 18, originY: 10, pxPerSquare: 51.2 });
  });

  it("applies with Enter", () => {
    loadMap({ pxPerSquare: 51.2, originX: 18, originY: 10 });
    store().startGridAlign();
    render(<LivePanel />);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(store().gridAlign).toBeNull();
    expect(store().encounter.map.image?.originX).toBe(17);
  });

  it("takes a typed grid offset, negative too, and the arrow keys in its box step it", async () => {
    loadMap({ pxPerSquare: 51.2, originX: 18, originY: 10 });
    store().startGridAlign();
    render(<LivePanel />);
    const x = screen.getByRole("textbox", { name: "Grid offset X" });
    const y = screen.getByRole("textbox", { name: "Grid offset Y" });
    expect((x as HTMLInputElement).value).toBe("18");
    await userEvent.clear(x);
    await userEvent.type(x, "-12.5");
    expect(store().gridAlign?.originX).toBe(-12.5);
    await userEvent.clear(y);
    await userEvent.type(y, "25");
    expect(store().gridAlign?.originY).toBe(25);
    // In a box the arrows step its number, and don't shift the grid as well.
    await userEvent.type(y, "{ArrowUp}");
    expect(store().gridAlign).toMatchObject({ originX: -12.5, originY: 26 });
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(store().encounter.map.image).toMatchObject({ originX: -12.5, originY: 26 });
  });

  it("cancels with Escape, and applies with Enter, from inside its boxes", async () => {
    loadMap({ pxPerSquare: 51.2, originX: 18, originY: 10 });
    store().startGridAlign();
    render(<LivePanel />);
    const x = screen.getByRole("textbox", { name: "Grid offset X" });
    await userEvent.clear(x);
    await userEvent.type(x, "40{Escape}");
    expect(store().gridAlign).toBeNull();
    expect(store().encounter.map.image?.originX).toBe(18);

    store().startGridAlign();
    const again = await screen.findByRole("textbox", { name: "Grid offset X" });
    await userEvent.clear(again);
    await userEvent.type(again, "40{Enter}");
    expect(store().gridAlign).toBeNull();
    expect(store().encounter.map.image?.originX).toBe(40);
  });

  it("doesn't refit an already fitted grid when it's only shifted", async () => {
    // 2048 × 1536 at 51.2 px is exactly the 40 × 30 grid, here already shifted a quarter square up.
    loadMap({ pxPerSquare: 51.2, originX: 0, originY: -12.8 });
    store().startGridAlign();
    render(<LivePanel />);
    // Half a square left: covering every last pixel would take 41 columns (and 31 rows).
    store().updateGridAlign({ originX: -25.6 });
    expect(await screen.findByLabelText(/Fit columns and rows to the image: 41 × 31 squares/)).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(store().encounter.map.grid).toMatchObject({ width: 40, height: 30 });
    expect(store().encounter.map.image?.originX).toBe(-25.6);
  });

  it("shifts the grid with the panel's arrows", async () => {
    loadMap({ pxPerSquare: 51.2, originX: 18, originY: 10 });
    store().startGridAlign();
    render(<LivePanel />);
    await userEvent.click(screen.getByRole("button", { name: "Shift the grid right" }));
    await userEvent.click(screen.getByRole("button", { name: "Shift the grid up" }));
    expect(store().gridAlign).toMatchObject({ originX: 19, originY: 9 });
  });

  it("keeps the image still on screen while the grid shifts over it", () => {
    loadMap({ pxPerSquare: 51.2, originX: 18, originY: 10 });
    store().startGridAlign();
    store().updateGridAlign({ originX: 18 + 25.6 });
    // Half a square of the image (25.6 px at 51.2 per square) is half of a 44 px square on screen.
    const shift = alignmentShift(store().gridAlign!, 44);
    expect(shift.x).toBeCloseTo(22, 9);
    expect(shift.y).toBe(0);
    // The image's own box moves the other way by as much, so it stays put.
    const box = deriveSceneMetrics(alignedMap(store().encounter.map, store().gridAlign!)).imageBox;
    expect(box.left + 22).toBeCloseTo(-(18 / 51.2) * 44, 9);
  });

  it("re-reads a box when its squares change", async () => {
    loadMap();
    store().startGridAlign();
    // A box drawn over 2 × 2 squares of a 51.2 px grid, read as one square at first.
    store().updateGridAlign({ pxPerSquare: 102.4, originX: 18, originY: 10, box: { a: { x: 18, y: 10 }, b: { x: 120.4, y: 112.4 }, across: 1, down: 1 } });
    render(<LivePanel />);
    await userEvent.click(screen.getByRole("button", { name: "More squares across" }));
    await userEvent.click(screen.getByRole("button", { name: "More squares down" }));
    expect(store().gridAlign?.pxPerSquare).toBeCloseTo(51.2, 9);
    expect(store().gridAlign?.box).toMatchObject({ across: 2, down: 2 });
    expect(screen.getByLabelText("squares across").textContent).toBe("2");
  });

  it("finds the drawn grid on the stored copy and measures it in the file's own pixels", async () => {
    // The file is 2048 × 1536; the stored copy the finder reads is half that.
    loadMap({ sourceWidthPx: 2048, sourceHeightPx: 1536, naturalWidthPx: 1024, naturalHeightPx: 768 });
    store().startGridAlign();
    render(<LivePanel />);
    await userEvent.click(screen.getByRole("button", { name: "Find the drawn grid" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Found lines every"));
    const draft = store().gridAlign!;
    expect(draft.pxPerSquare).toBeCloseTo(102.4, 0);
    expect(Math.abs(draft.originX - 36)).toBeLessThan(1);
    expect(Math.abs(draft.originY - 20)).toBeLessThan(1);
  });
});
