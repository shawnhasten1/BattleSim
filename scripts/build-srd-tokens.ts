/**
 * Builds the placeholder token for every bundled SRD monster, and the character builder's class, species and spell
 * school icons.
 *
 *   npm run srd:tokens          write public/tokens/srd/<slug>.svg, public/icons/builder/<group>-<name>.svg and
 *                               generated/token-icons.json
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
import { BUILDER_ICONS, renderBuilderIconSvg } from "./srd-tokens/builder-icons";
import { DRAGON_AGE_ICONS, DRAGON_COLORS, MONSTER_ICONS, parseDragonSlug } from "./srd-tokens/icon-map";
import { TYPE_COLORS, renderTokenSvg } from "./srd-tokens/render";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokenDir = join(root, "public/tokens/srd");
const builderIconDir = join(root, "public/icons/builder");
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

// The builder's icons (CHARACTER_BUILDER_UX_PLAN.md D14): the glyph alone, drawn as a mask in the builder's colours.
const builderFiles = new Map<string, string>();
for (const [key, choice] of Object.entries(BUILDER_ICONS)) {
  const [author, icon] = choice.split("/") as [string, string];
  const body = iconSet.icons[icon]?.body;
  if (!body) {
    errors.push(`builder ${key}: "${icon}" is not in @iconify-json/game-icons`);
    continue;
  }
  if (!AUTHORS[author]) {
    errors.push(`builder ${key}: no credit for author "${author}" (add it to AUTHORS)`);
    continue;
  }
  authorsUsed.add(author);
  builderFiles.set(`${key.replace("/", "-")}.svg`, renderBuilderIconSvg(body));
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
  monsters,
  builder: BUILDER_ICONS
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
  for (const [name, content] of builderFiles) {
    const target = join(builderIconDir, name);
    if (!existsSync(target) || normalize(readFileSync(target, "utf8")) !== content) {
      console.error(`  stale: public/icons/builder/${name}`);
      stale += 1;
    }
  }
  const extra = [
    ...(existsSync(tokenDir) ? readdirSync(tokenDir).filter((name) => !files.has(name)).map((name) => `public/tokens/srd/${name}`) : []),
    ...(existsSync(builderIconDir) ? readdirSync(builderIconDir).filter((name) => !builderFiles.has(name)).map((name) => `public/icons/builder/${name}`) : [])
  ];
  for (const name of extra) console.error(`  extra: ${name}`);
  if (!existsSync(manifestPath) || normalize(readFileSync(manifestPath, "utf8")) !== manifestText) {
    console.error("  stale: src/data/srd/monsters/generated/token-icons.json");
    stale += 1;
  }
  if (stale + extra.length > 0) {
    console.error("Run `npm run srd:tokens` and commit the result.");
    process.exit(1);
  }
  console.log(`${files.size} SRD tokens and ${builderFiles.size} builder icons up to date.`);
} else {
  rmSync(tokenDir, { recursive: true, force: true });
  mkdirSync(tokenDir, { recursive: true });
  for (const [name, content] of files) writeFileSync(join(tokenDir, name), content);
  rmSync(builderIconDir, { recursive: true, force: true });
  mkdirSync(builderIconDir, { recursive: true });
  for (const [name, content] of builderFiles) writeFileSync(join(builderIconDir, name), content);
  writeFileSync(manifestPath, manifestText);
  console.log(`Wrote ${files.size} SRD tokens and ${builderFiles.size} builder icons (${authorsUsed.size} icon authors).`);
}
