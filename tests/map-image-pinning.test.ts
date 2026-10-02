import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAP_IMAGE_SETTINGS, encounterSnapshotSchema, sampleEncounter, type EncounterSnapshot, type MapImageSettings } from "@/engine";
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
});
