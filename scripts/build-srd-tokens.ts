/**
 * Builds the placeholder token for every bundled SRD monster.
 *
 *   npm run srd:tokens          write public/tokens/srd/<slug>.svg and generated/token-icons.json
 *   npm run srd:tokens:check    build in memory and fail if the committed files differ
 *
 * Each token is a game-icons.net glyph (CC BY 3.0) on a disc coloured by creature type (true
 * dragons: by their colour). Which icon a monster gets is `scripts/srd-tokens/icon-map.ts`. See
 * SRD_TOKEN_IMAGES_PLAN.md.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SrdMonsterIndexEntry } from "../src/data/srd/monsters/types";
import { DRAGON_AGE_ICONS, DRAGON_COLORS, MONSTER_ICONS, parseDragonSlug } from "./srd-tokens/icon-map";
import { TYPE_COLORS, renderTokenSvg } from "./srd-tokens/render";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokenDir = join(root, "public/tokens/srd");
const manifestPath = join(root, "src/data/srd/monsters/generated/token-icons.json");
const check = process.argv.includes("--check");

/** game-icons.net contributors, as its license.txt names them (folder → credit name, link). */
const AUTHORS: Record<string, { name: string; url?: string }> = {
  "carl-olsen": { name: "Carl Olsen", url: "https://twitter.com/unstoppableCarl" },
  "caro-asercion": { name: "Caro Asercion" },
  cathelineau: { name: "Cathelineau" },
  darkzaitzev: { name: "DarkZaitzev", url: "http://darkzaitzev.deviantart.com" },
  delapouite: { name: "Delapouite", url: "https://delapouite.com" },
  "kier-heyl": { name: "Kier Heyl" },
  lorc: { name: "Lorc", url: "http://lorcblog.blogspot.com" },
  lucasms: { name: "Lucas" },
  sbed: { name: "Sbed", url: "http://opengameart.org/content/95-game-icons" },
  skoll: { name: "Skoll" },
  sparker: { name: "Sparker", url: "http://citizenparker.com" }
};

const require = createRequire(import.meta.url);
const iconSet = require("@iconify-json/game-icons/icons.json") as { icons: Record<string, { body: string }> };
const index = JSON.parse(readFileSync(join(root, "src/data/srd/monsters/generated/monster-index.json"), "utf8")) as {
  monsters: SrdMonsterIndexEntry[];
};

const errors: string[] = [];
const files = new Map<string, string>();
const monsters: Record<string, string> = {};
const authorsUsed = new Set<string>();

for (const monster of index.monsters) {
  const dragon = parseDragonSlug(monster.slug);
  const choice = dragon ? DRAGON_AGE_ICONS[dragon.age] : MONSTER_ICONS[monster.slug];
  if (!choice) {
    errors.push(`${monster.slug}: no icon in scripts/srd-tokens/icon-map.ts`);
    continue;
  }
  const [author, icon] = choice.split("/") as [string, string];
  const body = iconSet.icons[icon]?.body;
  if (!body) {
    errors.push(`${monster.slug}: "${icon}" is not in @iconify-json/game-icons`);
    continue;
  }
  if (!AUTHORS[author]) {
    errors.push(`${monster.slug}: no credit for author "${author}" (add it to AUTHORS)`);
    continue;
  }
  authorsUsed.add(author);
  monsters[monster.slug] = choice;
  const color = dragon ? DRAGON_COLORS[dragon.color]! : TYPE_COLORS[monster.type];
  files.set(`${monster.slug}.svg`, renderTokenSvg(body, color, monster.name));
}

for (const slug of Object.keys(MONSTER_ICONS)) {
  if (!index.monsters.some((monster) => monster.slug === slug)) errors.push(`icon-map has "${slug}", which isn't in the monster index`);
}

if (errors.length > 0) {
  for (const message of errors) console.error(`  ✗ ${message}`);
  process.exit(1);
}

const manifest = {
  source: "https://game-icons.net",
  license: { title: "CC BY 3.0", url: "https://creativecommons.org/licenses/by/3.0/" },
  authors: [...authorsUsed].sort().map((folder) => ({ folder, ...AUTHORS[folder] })),
  monsters
};
const manifestText = `${JSON.stringify(manifest, null, 1)}\n`;

if (check) {
  const normalize = (text: string) => text.replace(/\r\n/g, "\n");
  let stale = 0;
  for (const [name, content] of files) {
    const target = join(tokenDir, name);
    if (!existsSync(target) || normalize(readFileSync(target, "utf8")) !== content) {
      console.error(`  stale: public/tokens/srd/${name}`);
      stale += 1;
    }
  }
  const extra = existsSync(tokenDir) ? readdirSync(tokenDir).filter((name) => !files.has(name)) : [];
  for (const name of extra) console.error(`  extra: public/tokens/srd/${name}`);
  if (!existsSync(manifestPath) || normalize(readFileSync(manifestPath, "utf8")) !== manifestText) {
    console.error("  stale: src/data/srd/monsters/generated/token-icons.json");
    stale += 1;
  }
  if (stale + extra.length > 0) {
    console.error("Run `npm run srd:tokens` and commit the result.");
    process.exit(1);
  }
  console.log(`${files.size} SRD tokens up to date.`);
} else {
  rmSync(tokenDir, { recursive: true, force: true });
  mkdirSync(tokenDir, { recursive: true });
  for (const [name, content] of files) writeFileSync(join(tokenDir, name), content);
  writeFileSync(manifestPath, manifestText);
  console.log(`Wrote ${files.size} SRD tokens (${authorsUsed.size} icon authors).`);
}
