import { describe, expect, it } from "vitest";
import type { CreatureDefinition } from "@/engine";
import { imageSource } from "@/lib/actor-sheet/token";
import { resolveTokenVisuals, srdSlugOf, tokenImageSource } from "@/lib/token-image";

const srdGoblin: Pick<CreatureDefinition, "tokenVisuals" | "source"> = {
  source: { provider: "srd", documentKey: "srd-2014", slug: "goblin" }
};
const homebrew: Pick<CreatureDefinition, "tokenVisuals" | "source"> = { source: { provider: "homebrew" } };
const device = { goblin: "blob:device-goblin" };

describe("token image resolution", () => {
  it("finds the SRD monster by source, so a saved copy with a new id keeps its art", () => {
    expect(srdSlugOf(srdGoblin)).toBe("goblin");
    expect(srdSlugOf({ source: { provider: "open5e", slug: "goblin" } })).toBeUndefined();
    expect(srdSlugOf({})).toBeUndefined();
  });

  it("falls back to the SRD placeholder when nothing else is set", () => {
    expect(resolveTokenVisuals(srdGoblin).imageUrl).toBe("/tokens/srd/goblin.svg");
    expect(tokenImageSource(srdGoblin)).toBe("placeholder");
  });

  it("prefers this device's imported art to the placeholder", () => {
    expect(resolveTokenVisuals(srdGoblin, undefined, device).imageUrl).toBe("blob:device-goblin");
    expect(tokenImageSource(srdGoblin, undefined, device)).toBe("device");
  });

  it("prefers the creature's own image to imported art, and the token's to both", () => {
    const withImage = { ...srdGoblin, tokenVisuals: { imageUrl: "data:creature" } };
    expect(resolveTokenVisuals(withImage, undefined, device).imageUrl).toBe("data:creature");
    expect(imageSource(withImage, {}, device)).toBe("creature");
    const token = { tokenVisuals: { imageUrl: "data:token", borderColor: "#123456" } };
    expect(resolveTokenVisuals(withImage, token, device)).toEqual({ imageUrl: "data:token", borderColor: "#123456" });
    expect(imageSource(withImage, token, device)).toBe("token");
  });

  it("keeps the token's other visuals when the image comes from the fallback", () => {
    expect(resolveTokenVisuals({ ...srdGoblin, tokenVisuals: { scale: 1.2 } }, { tokenVisuals: { tint: "#fff" } }))
      .toEqual({ scale: 1.2, tint: "#fff", imageUrl: "/tokens/srd/goblin.svg" });
  });

  it("leaves a creature that isn't from the SRD on its initials", () => {
    expect(resolveTokenVisuals(homebrew, undefined, device).imageUrl).toBeUndefined();
    expect(tokenImageSource(homebrew, undefined, device)).toBeUndefined();
  });
});
