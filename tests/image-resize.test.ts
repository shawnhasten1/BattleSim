import { describe, expect, it } from "vitest";
import { dataUrlBytes, downscaleDataUrl, encodeWithinBudget, MAP_MAX_DATA_URL_CHARS, MAP_MAX_EDGE, mapStorageOptions } from "@/lib/imageResize";

describe("mapStorageOptions: how big a map background is stored", () => {
  it("keeps a 100 px per square export whole", () => {
    expect(mapStorageOptions({ widthPx: 3000, heightPx: 2000 }, 100).maxEdge).toBe(3000);
  });

  it("stores a denser export at 100 px per square", () => {
    // 30 × 20 at 200 px per square: 6000 wide, stored 3000.
    expect(mapStorageOptions({ widthPx: 6000, heightPx: 4000 }, 200).maxEdge).toBe(3000);
  });

  it("keeps a coarser one whole (Roll20's 70 px)", () => {
    expect(mapStorageOptions({ widthPx: 2100, heightPx: 1750 }, 70).maxEdge).toBe(2100);
  });

  it("never goes past a 4096 px edge", () => {
    expect(mapStorageOptions({ widthPx: 6000, heightPx: 4000 }, 100).maxEdge).toBe(MAP_MAX_EDGE);
    expect(mapStorageOptions({ widthPx: 8000, heightPx: 8000 }).maxEdge).toBe(MAP_MAX_EDGE);
  });

  it("keeps an unknown grid's image up to the cap, and always within the Blob sync's budget", () => {
    expect(mapStorageOptions({ widthPx: 2048, heightPx: 1536 })).toEqual({ maxEdge: 2048, maxChars: MAP_MAX_DATA_URL_CHARS });
    expect(mapStorageOptions(null)).toEqual({ maxEdge: MAP_MAX_EDGE, maxChars: MAP_MAX_DATA_URL_CHARS });
  });
});

describe("encodeWithinBudget", () => {
  /** A stand-in encoder: output length grows with the pixels drawn and the quality. */
  const encoder = (calls: Array<[number, number]>) => (scale: number, quality: number) => {
    calls.push([Math.round(scale * 1000) / 1000, quality]);
    return "x".repeat(Math.round(1000 * scale * scale * quality));
  };

  it("takes the first encoding when it fits", () => {
    const calls: Array<[number, number]> = [];
    expect(encodeWithinBudget(encoder(calls), 0.82, 1000)).toHaveLength(820);
    expect(calls).toEqual([[1, 0.82]]);
  });

  it("lowers the quality first, then the size", () => {
    const calls: Array<[number, number]> = [];
    const encoded = encodeWithinBudget(encoder(calls), 0.82, 400);
    expect(encoded.length).toBeLessThanOrEqual(400);
    expect(calls.slice(0, 3)).toEqual([[1, 0.82], [1, 0.72], [1, 0.62]]);
    expect(calls[3]).toEqual([0.85, 0.62]);
  });

  it("gives its smallest attempt when nothing fits", () => {
    const calls: Array<[number, number]> = [];
    encodeWithinBudget(encoder(calls), 0.82, 1, 0.25);
    expect(calls.at(-1)![0]).toBeLessThanOrEqual(0.25);
  });
});

describe("dataUrlBytes", () => {
  it("approximates the decoded payload size of a data URL", () => {
    // "AAAA" base64 -> 3 bytes
    expect(dataUrlBytes("data:image/png;base64,AAAA")).toBe(3);
    // padding is accounted for
    expect(dataUrlBytes("data:image/png;base64,AAA=")).toBe(2);
    expect(dataUrlBytes("data:image/png;base64,AA==")).toBe(1);
  });

  it("falls back to string length when there is no comma", () => {
    expect(dataUrlBytes("not-a-data-url")).toBe("not-a-data-url".length);
  });
});

describe("downscaleDataUrl", () => {
  it("passes non-raster and non-image inputs straight through", async () => {
    const svg = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    await expect(downscaleDataUrl(svg)).resolves.toBe(svg);
    await expect(downscaleDataUrl("https://example.com/map.png")).resolves.toBe("https://example.com/map.png");
  });

  it("never throws — returns the original string if decoding fails", async () => {
    const broken = "data:image/png;base64,%%%not-base64%%%";
    await expect(downscaleDataUrl(broken)).resolves.toBe(broken);
  });
});
