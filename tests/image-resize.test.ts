import { describe, expect, it } from "vitest";
import { dataUrlBytes, downscaleDataUrl } from "@/lib/imageResize";

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
