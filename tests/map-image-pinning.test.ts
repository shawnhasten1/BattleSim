import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAP_IMAGE_SETTINGS, encounterSnapshotSchema, sampleEncounter, type EncounterSnapshot, type MapImageSettings } from "@/engine";
import { deriveSceneMetrics } from "@/components/scene/metrics";
import { useEncounterStore } from "@/store/encounter-store";

// No canvas in node: stand in for the downscale, which shrinks every upload to 2048 x 1365 here.
vi.mock("@/lib/imageResize", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/imageResize")>()),
  downscaleDataUrl: vi.fn(async (dataUrl: string) => dataUrl),
  getImageDimensions: vi.fn(async () => ({ width: 2048, height: 1365 }))
}));

const IMAGE = "data:image/png;base64,AAAA";

/** A background pinned to the grid: a 30 x 20 export at 100 px per square, drawn with a border. */
const PINNED: MapImageSettings = {
  ...DEFAULT_MAP_IMAGE_SETTINGS,
  naturalWidthPx: 1024,
  naturalHeightPx: 683,
  sourceWidthPx: 3000,
  sourceHeightPx: 2000,
  pxPerSquare: 100,
  originX: 10,
  originY: 5
};

function encounterWithImage(image: MapImageSettings): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.map.image = { ...image };
  return encounter;
}

const mapImage = () => useEncounterStore.getState().encounter.map.image;

describe("encounterSnapshotSchema keeps the grid pin", () => {
  it("keeps the source size, px per square and origin through a parse, so saves don't drop them", () => {
    const parsed = encounterSnapshotSchema.parse(encounterWithImage(PINNED));
    expect(parsed.map.image).toEqual(PINNED);
  });

  it("parses a snapshot without them as before", () => {
    const parsed = encounterSnapshotSchema.parse(structuredClone(sampleEncounter));
    expect(parsed.map.image).toEqual(DEFAULT_MAP_IMAGE_SETTINGS);
  });

  it("rejects a px per square that isn't positive", () => {
    expect(() => encounterSnapshotSchema.parse(encounterWithImage({ ...PINNED, pxPerSquare: 0 }))).toThrow();
  });
});

describe("setMapImage records the picked file's own size", () => {
  it("stores the file's size next to the downscaled size, and doesn't pin it", async () => {
    useEncounterStore.getState().replaceEncounter(structuredClone(sampleEncounter));
    useEncounterStore.getState().setMapImage(IMAGE, { widthPx: 3000, heightPx: 2000 });
    await vi.waitFor(() => expect(mapImage()?.sourceWidthPx).toBe(3000));
    expect(mapImage()).toMatchObject({ sourceWidthPx: 3000, sourceHeightPx: 2000, naturalWidthPx: 2048, naturalHeightPx: 1365 });
    expect(mapImage()?.pxPerSquare).toBeUndefined();
    expect(useEncounterStore.getState().encounter.map.canvas).toEqual({ widthPx: 2048, heightPx: 1365 });
  });

  it("drops the previous image's pin, which was measured against that image", async () => {
    useEncounterStore.getState().replaceEncounter(encounterWithImage(PINNED));
    useEncounterStore.getState().setMapImage(IMAGE, { widthPx: 4200, heightPx: 2800 });
    await vi.waitFor(() => expect(mapImage()?.sourceWidthPx).toBe(4200));
    expect(mapImage()?.sourceHeightPx).toBe(2800);
    expect(mapImage()?.pxPerSquare).toBeUndefined();
    expect(mapImage()?.originX).toBeUndefined();
    expect(mapImage()?.originY).toBeUndefined();
  });

  it("clears the old size and pin when the new file couldn't be measured", async () => {
    useEncounterStore.getState().replaceEncounter(encounterWithImage(PINNED));
    useEncounterStore.getState().setMapImage(IMAGE, null);
    await vi.waitFor(() => expect(mapImage()?.naturalWidthPx).toBe(2048));
    expect(mapImage()?.sourceWidthPx).toBeUndefined();
    expect(mapImage()?.sourceHeightPx).toBeUndefined();
    expect(mapImage()?.pxPerSquare).toBeUndefined();
  });

  it("keeps an imported snapshot's own fields when no source is given (Import JSON)", async () => {
    useEncounterStore.getState().replaceEncounter(encounterWithImage(PINNED), IMAGE);
    await vi.waitFor(() => expect(mapImage()?.naturalWidthPx).toBe(2048));
    expect(mapImage()).toMatchObject({ sourceWidthPx: 3000, sourceHeightPx: 2000, pxPerSquare: 100, originX: 10, originY: 5 });
  });
});

describe("createEncounterInCampaign records the picked file's own size", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("bakes it into the new encounter's snapshot (New Encounter modal)", async () => {
    const posted: Array<{ encounter?: EncounterSnapshot }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (typeof init?.body === "string") posted.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ encounter: { id: "enc-new" } }), { status: 200 });
    }));

    const id = await useEncounterStore.getState().createEncounterInCampaign("campaign-1", "Crypt", {
      grid: { width: 40, height: 30, distancePerSquare: 5, squareSizePx: 44 },
      image: { dataUrl: IMAGE, fileName: "crypt.png", size: { widthPx: 3000, heightPx: 2000 } }
    });

    expect(id).toBe("enc-new");
    const snapshot = posted.find((body) => body.encounter)?.encounter;
    expect(snapshot?.map.image).toMatchObject({ naturalWidthPx: 2048, naturalHeightPx: 1365, sourceWidthPx: 3000, sourceHeightPx: 2000 });
    expect(snapshot?.map.image?.pxPerSquare).toBeUndefined();
    expect(snapshot?.map.canvas).toEqual({ widthPx: 2048, heightPx: 1365 });
  });

  it("pins the image when the grid was read off it", async () => {
    const posted: Array<{ encounter?: EncounterSnapshot }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (typeof init?.body === "string") posted.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ encounter: { id: "enc-pinned" } }), { status: 200 });
    }));

    await useEncounterStore.getState().createEncounterInCampaign("campaign-1", "Crypt", {
      grid: { width: 30, height: 20, distancePerSquare: 5, squareSizePx: 44, pxPerSquare: 100 },
      image: { dataUrl: IMAGE, fileName: "crypt.png", size: { widthPx: 3000, heightPx: 2000 } }
    });

    const snapshot = posted.find((body) => body.encounter)?.encounter;
    expect(snapshot?.map.grid).toMatchObject({ width: 30, height: 20 });
    expect(snapshot?.map.image).toMatchObject({ sourceWidthPx: 3000, sourceHeightPx: 2000, pxPerSquare: 100 });
    expect(deriveSceneMetrics(snapshot!.map).imageBox).toEqual({ left: 0, top: 0, width: 1320, height: 880, pinned: true });
  });

  it("brings a Universal VTT file's walls and doors into the new map", async () => {
    const posted: Array<{ encounter?: EncounterSnapshot }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (typeof init?.body === "string") posted.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ encounter: { id: "enc-uvtt" } }), { status: 200 });
    }));
    const walls = [
      { id: "uvtt-wall-1", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, blocksMovement: true, blocksSight: true, blocksProjectiles: true, cover: "total" as const },
      { id: "uvtt-wall-2", start: { x: 5, y: 4 }, end: { x: 6, y: 4 }, blocksMovement: true, blocksSight: true, blocksProjectiles: true, cover: "total" as const, doorState: "closed" as const }
    ];

    await useEncounterStore.getState().createEncounterInCampaign("campaign-1", "Dungeon", {
      grid: { width: 10, height: 8, distancePerSquare: 5, squareSizePx: 44, pxPerSquare: 100 },
      image: { dataUrl: IMAGE, fileName: "dungeon.dd2vtt", size: { widthPx: 1000, heightPx: 800 } },
      walls
    });

    const snapshot = posted.find((body) => body.encounter)?.encounter;
    expect(snapshot?.map.walls).toEqual(walls);
    expect(snapshot?.map.image).toMatchObject({ pxPerSquare: 100, sourceWidthPx: 1000 });
  });
});

/** The sample encounter on a 30 × 20 grid with a background (walls and tokens are placed). */
function placedMap(image: MapImageSettings): EncounterSnapshot {
  const encounter = encounterWithImage(image);
  encounter.map.grid = { ...encounter.map.grid, width: 30, height: 20, squareSizePx: 44 };
  return encounter;
}

describe("replaceMapImage sets the grid from the image", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pins a re-export at the map's own grid, in one undo step", async () => {
    useEncounterStore.getState().replaceEncounter(placedMap(PINNED));
    const steps = useEncounterStore.getState().undoStack.length;
    const outcome = useEncounterStore.getState().replaceMapImage({ dataUrl: IMAGE, fileName: "crypt-hd.png", size: { widthPx: 6000, heightPx: 4000 } });
    expect(outcome).toEqual({ kind: "keep-grid", fit: { columns: 30, rows: 20, pxPerSquare: 200 } });
    await vi.waitFor(() => expect(mapImage()?.sourceWidthPx).toBe(6000));
    expect(mapImage()).toMatchObject({ sourceHeightPx: 4000, pxPerSquare: 200 });
    expect(mapImage()?.originX).toBeUndefined();
    expect(useEncounterStore.getState().encounter.map.grid).toMatchObject({ width: 30, height: 20 });
    expect(useEncounterStore.getState().undoStack.length).toBe(steps + 1);
  });

  it("gives a blank map the image's grid", async () => {
    const blank = structuredClone(sampleEncounter);
    blank.map.walls = [];
    blank.map.terrain = [];
    blank.combatants = [];
    useEncounterStore.getState().replaceEncounter(blank);
    const outcome = useEncounterStore.getState().replaceMapImage({ dataUrl: IMAGE, fileName: "crypt.png", size: { widthPx: 3000, heightPx: 2000 } });
    expect(outcome).toEqual({ kind: "new-grid", fit: { columns: 30, rows: 20, pxPerSquare: 100 }, confirm: null });
    await vi.waitFor(() => expect(useEncounterStore.getState().encounter.map.grid.width).toBe(30));
    expect(useEncounterStore.getState().encounter.map.grid.height).toBe(20);
    expect(mapImage()).toMatchObject({ sourceWidthPx: 3000, sourceHeightPx: 2000, pxPerSquare: 100 });
  });

  it("changes nothing when the DM declines a new grid under placed walls", async () => {
    useEncounterStore.getState().replaceEncounter(placedMap(PINNED));
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    const outcome = useEncounterStore.getState().replaceMapImage({ dataUrl: IMAGE, fileName: "wider.png", size: { widthPx: 3200, heightPx: 2000 } });
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("The new image is 32 × 20 squares; this map is 30 × 20."));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mapImage()).toMatchObject({ sourceWidthPx: 3000, pxPerSquare: 100 });
    expect(useEncounterStore.getState().encounter.map.grid.width).toBe(30);
  });

  it("puts an image it can't read a grid off in unpinned, for Scene Config to ask about", async () => {
    useEncounterStore.getState().replaceEncounter(placedMap(PINNED));
    const outcome = useEncounterStore.getState().replaceMapImage({ dataUrl: IMAGE, fileName: "plain-2k.png", size: { widthPx: 2048, heightPx: 1536 } });
    expect(outcome).toEqual({ kind: "ask" });
    await vi.waitFor(() => expect(mapImage()?.sourceWidthPx).toBe(2048));
    expect(mapImage()?.pxPerSquare).toBeUndefined();
    expect(useEncounterStore.getState().encounter.map.grid.width).toBe(30);
  });
});

describe("Scene Config's image actions", () => {
  it("applyImageFit pins a reading of the whole image and sizes the grid to it", () => {
    useEncounterStore.getState().replaceEncounter(placedMap({ ...PINNED, pxPerSquare: undefined }));
    useEncounterStore.getState().applyImageFit({ columns: 15, rows: 10, pxPerSquare: 200 });
    expect(useEncounterStore.getState().encounter.map.grid).toMatchObject({ width: 15, height: 10 });
    expect(mapImage()).toMatchObject({ sourceWidthPx: 3000, sourceHeightPx: 2000, pxPerSquare: 200 });
    // A whole-image reading starts at the image's corner.
    expect(mapImage()?.originX).toBeUndefined();
    expect(mapImage()?.originY).toBeUndefined();
  });

  it("applyImageFit measures an old upload against its stored size", () => {
    useEncounterStore.getState().replaceEncounter(placedMap({ ...DEFAULT_MAP_IMAGE_SETTINGS, naturalWidthPx: 2048, naturalHeightPx: 1536 }));
    useEncounterStore.getState().applyImageFit({ columns: 40, rows: 30, pxPerSquare: 51.2 });
    expect(mapImage()).toMatchObject({ sourceWidthPx: 2048, sourceHeightPx: 1536, pxPerSquare: 51.2 });
  });

  it("fitGridToImage covers the image from the grid's corner", () => {
    const encounter = placedMap({ ...PINNED, originX: 0, originY: 0 });
    encounter.map.grid.width = 35;
    useEncounterStore.getState().replaceEncounter(encounter);
    useEncounterStore.getState().fitGridToImage();
    expect(useEncounterStore.getState().encounter.map.grid).toMatchObject({ width: 30, height: 20 });

    useEncounterStore.getState().replaceEncounter(placedMap({ ...PINNED, originX: 100, originY: 0 }));
    useEncounterStore.getState().fitGridToImage();
    expect(useEncounterStore.getState().encounter.map.grid).toMatchObject({ width: 29, height: 20 });
  });

  it("pinMapImageInPlace keeps the image exactly where it was drawn", () => {
    const image: MapImageSettings = { ...DEFAULT_MAP_IMAGE_SETTINGS, offsetX: 22, offsetY: -10, scale: 110, naturalWidthPx: 2048, naturalHeightPx: 1365, sourceWidthPx: 3000, sourceHeightPx: 2000 };
    const encounter = placedMap(image);
    encounter.map.canvas = { widthPx: 2048, heightPx: 1365 };
    useEncounterStore.getState().replaceEncounter(encounter);
    useEncounterStore.getState().pinMapImageInPlace();
    const box = deriveSceneMetrics(useEncounterStore.getState().encounter.map).imageBox;
    expect(box.pinned).toBe(true);
    // Unpinned it was drawn at the offset, 110% of the 2048 px canvas box.
    expect(box.left).toBeCloseTo(22, 6);
    expect(box.top).toBeCloseTo(-10, 6);
    expect(box.width).toBeCloseTo(2048 * 1.1, 6);
    // The grid itself doesn't change.
    expect(useEncounterStore.getState().encounter.map.grid).toMatchObject({ width: 30, height: 20 });
  });
});
