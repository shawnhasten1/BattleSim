import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODEX_PALETTES, contrastRatio } from "@/lib/actor-sheet/codex";
import { TONE_COLORS } from "@/components/rules-card/tones";

// CHARACTER_BUILDER_UX_PLAN.md §7: a spell's element colour (its tile's edge, its card's, its square in "Your spells")
// reads against each look's tiles at 3:1, the contrast a meaningful border needs. On the Codex's Light palette the
// colour is shaded to 55% (`color-mix(in srgb, <tone> 55%, #000)`), as the stylesheets say.

const shade = (hex: string, keep: number) => {
  const channels = [1, 3, 5].map((at) => Math.round(parseInt(hex.slice(at, at + 2), 16) * keep));
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
};
/** Standard's tile: its panel with the faint white wash on top. */
const STANDARD_TILE = "#1b1f25";

describe("spell colours in the builder", () => {
  it.each(Object.entries(TONE_COLORS))("%s reads on the tiles of every look", (_tone, color) => {
    expect(contrastRatio(color, CODEX_PALETTES.dark.tokens["--panel-2"]!)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(color, STANDARD_TILE)).toBeGreaterThanOrEqual(3);
    for (const surface of [CODEX_PALETTES.light.tokens["--panel-2"]!, CODEX_PALETTES.light.tokens["--panel"]!, CODEX_PALETTES.light.tokens["--panel-hi"]!]) {
      expect(contrastRatio(shade(color, 0.55), surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it("is shaded on the Light palette, in the builder's tiles and the rules card", () => {
    const builder = readFileSync(join(__dirname, "../src/components/builder/builder.module.css"), "utf8");
    const card = readFileSync(join(__dirname, "../src/components/rules-card/rules-card.module.css"), "utf8");
    expect(builder).toMatch(/\[data-dark="false"\] \.spellTile,\s*\[data-dark="false"\] \.yourTone \{\s*--tone-edge: color-mix\(in srgb, var\(--tone\) 55%, #000\);/);
    expect(card).toMatch(/color-mix\(in srgb, var\(--tone, var\(--ui-accent\)\) 55%, #000\)/);
  });

  it("says a finished choice in green that reads on Standard's panels", () => {
    expect(contrastRatio("#3f9d6a", STANDARD_TILE)).toBeGreaterThanOrEqual(4.5);
  });
});
