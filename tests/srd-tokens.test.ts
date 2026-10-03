import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/data/srd/monsters/generated/token-icons.json";
import { SRD_MONSTER_INDEX_WITH_FORMS } from "@/data/srd/monsters";
import { SRD_TOKEN_ICON_CREDITS, placeholderTokenUrl } from "@/data/srd/tokens";
import { DRAGON_AGE_ICONS, MONSTER_ICONS, parseDragonSlug } from "../scripts/srd-tokens/icon-map";
import { iconColorFor, luminance } from "../scripts/srd-tokens/render";

const tokenDir = join(__dirname, "../public/tokens/srd");

describe("SRD placeholder tokens", () => {
  it("ships a token for every library monster, its shapechanger forms included", () => {
    const missing = SRD_MONSTER_INDEX_WITH_FORMS.filter((entry) => !existsSync(join(tokenDir, `${entry.slug}.svg`)));
    expect(missing.map((entry) => entry.slug)).toEqual([]);
    for (const entry of SRD_MONSTER_INDEX_WITH_FORMS) expect(placeholderTokenUrl(entry.slug)).toBe(`/tokens/srd/${entry.slug}.svg`);
  });

  it("ships nothing that isn't a library monster's token", () => {
    const slugs = new Set(SRD_MONSTER_INDEX_WITH_FORMS.map((entry) => entry.slug));
    expect(readdirSync(tokenDir).filter((file) => !slugs.has(file.replace(/\.svg$/, "")))).toEqual([]);
    expect(placeholderTokenUrl("not-a-monster")).toBeUndefined();
    expect(placeholderTokenUrl(undefined)).toBeUndefined();
    expect(placeholderTokenUrl("__proto__")).toBeUndefined();
  });

  it("gives each token a self-contained SVG titled with the monster's name", () => {
    const svg = readFileSync(join(tokenDir, "ancient-red-dragon.svg"), "utf8");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain("<title>Ancient Red Dragon</title>");
    expect(svg).not.toMatch(/href=|<script/i);
  });

  it("maps every icon through the icon map, true dragons by their age", () => {
    for (const entry of SRD_MONSTER_INDEX_WITH_FORMS) {
      const dragon = parseDragonSlug(entry.slug);
      const expected = dragon ? DRAGON_AGE_ICONS[dragon.age] : MONSTER_ICONS[entry.slug];
      expect(manifest.monsters[entry.slug as keyof typeof manifest.monsters], entry.slug).toBe(expected);
    }
    expect(parseDragonSlug("red-dragon-wyrmling")).toEqual({ age: "wyrmling", color: "red" });
    expect(parseDragonSlug("ancient-gold-dragon")).toEqual({ age: "ancient", color: "gold" });
    expect(parseDragonSlug("dragon-turtle")).toBeUndefined();
    expect(parseDragonSlug("half-red-dragon-veteran")).toBeUndefined();
  });

  it("credits exactly the icon authors the tokens use", () => {
    const used = new Set(Object.values(manifest.monsters).map((choice) => choice.split("/")[0]));
    expect(SRD_TOKEN_ICON_CREDITS.authors.map((author) => author.folder).sort()).toEqual([...used].sort());
    expect(SRD_TOKEN_ICON_CREDITS.license.title).toBe("CC BY 3.0");
  });

  it("draws the icon in whichever of light or dark reads better on the disc", () => {
    expect(iconColorFor("#d9e2ea")).toBe("#1f2126"); // white dragon
    expect(iconColorFor("#2a2a2e")).toBe("#f3eee4"); // black dragon
    expect(luminance("#ffffff")).toBeCloseTo(1);
    expect(luminance("#000000")).toBeCloseTo(0);
  });
});
