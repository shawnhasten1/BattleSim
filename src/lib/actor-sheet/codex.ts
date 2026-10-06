import type { CreatureDefinition } from "@/engine";
import type { CharacterBuild } from "@/lib/character-builder/build-record";
import type { BuildSources } from "@/lib/character-builder/build";
import { formatChallengeRating } from "@/lib/srd-monster-tree";

/* ─── palettes (CHARACTER_SHEET_WINDOWS_PLAN.md D6, as Character Codex.html has them) ─── */

export type CodexPaletteId = "dark" | "light";

/**
 * A Codex palette: CSS custom properties set on the Codex's root, the Character Codex's own dark and light sets. The
 * banner across the top is the same deep teal in both. `--panel` is what text sits on, so `--ink`, `--muted`, `--cu`
 * (copper) and `--faint` are checked against it.
 */
export interface CodexPalette {
  label: string;
  dark: boolean;
  tokens: Record<`--${string}`, string>;
}

export const CODEX_PALETTES: Record<CodexPaletteId, CodexPalette> = {
  dark: {
    label: "Dark",
    dark: true,
    tokens: {
      "--page": "#0E1C1F", "--dot": "rgba(160,210,200,.06)",
      "--panel": "#15282C", "--panel-2": "#1A3135", "--panel-hi": "#1F393E",
      "--edge": "#2E4D52", "--edge-2": "#223D41",
      "--ink": "#ECE5D6", "--muted": "#97ACA8", "--faint": "#6C8582",
      "--cu": "#DD8E57", "--cu-hi": "#F2B488", "--cu-lo": "#9E5A2C", "--cu-ink": "#1B120B", "--cu-soft": "rgba(221,142,87,.14)",
      "--field": "#0F1F22", "--field-edge": "#2A464A",
      "--well": "#0A1618", "--row": "rgba(236,229,214,.07)",
      "--jade": "#3FA78A", "--jade-hi": "#6CCBAE", "--verm": "#E0604F", "--steel": "#79A6CE", "--pip": "#58716E",
      "--warn": "#E2BC70", "--good": "#6CCBAE",
      "--shadow": "rgba(0,0,0,.5)"
    }
  },
  light: {
    label: "Light",
    dark: false,
    tokens: {
      "--page": "#E3E8E5", "--dot": "rgba(21,42,46,.11)",
      "--panel": "#F6F8F6", "--panel-2": "#EAF0ED", "--panel-hi": "#FFFFFF",
      "--edge": "#B0C1BD", "--edge-2": "#D3DDDA",
      "--ink": "#152A2E", "--muted": "#4B6360", "--faint": "#71877F",
      "--cu": "#AC5C27", "--cu-hi": "#D58A55", "--cu-lo": "#7B3F17", "--cu-ink": "#FFF8F1", "--cu-soft": "rgba(172,92,39,.13)",
      "--field": "#FFFFFF", "--field-edge": "#C2CFCB",
      "--well": "#183034", "--row": "rgba(21,42,46,.09)",
      "--jade": "#2B8770", "--jade-hi": "#4CB094", "--verm": "#BF4337", "--steel": "#3B6890", "--pip": "#8BA09C",
      "--warn": "#8A5F0E", "--good": "#22735F",
      "--shadow": "rgba(20,40,40,.18)"
    }
  }
};

export const CODEX_PALETTE_IDS = Object.keys(CODEX_PALETTES) as CodexPaletteId[];

/** A palette remembered from before (the Faerie-based Codex's): its light one is Light, the others Dark. */
export function paletteFrom(stored: unknown): CodexPaletteId {
  if (stored === "light" || stored === "parchment") return "light";
  return "dark";
}

/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const channel = (at: number) => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/* ─── who it is ───────────────────────────────────────────────────────────── */

/** The hero sentence's parts: "A level 7 Rogue (Thief), Elf by birth, Sage by trade". */
export interface CodexIdentity {
  /** A character's classes ("Rogue 7 (Thief)"), or a monster's size and type ("Small humanoid"). */
  what: string;
  level?: number;
  species?: string;
  background?: string;
  /** Its challenge rating, for a monster ("1/4"). */
  challenge?: string;
}

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export function identityOf(definition: CreatureDefinition, build: CharacterBuild | undefined, sources: BuildSources): CodexIdentity {
  if (build) {
    const counts = new Map<string, number>();
    for (const level of build.levels) counts.set(level.classId, (counts.get(level.classId) ?? 0) + 1);
    const classes = [...counts].map(([classId, level]) => {
      const name = sources.catalog.classes.find((entry) => entry.id === classId)?.name ?? classId;
      const subclassId = build.levels.map((entry) => entry.choices.subclass)
        .find((value): value is string => typeof value === "string" && sources.catalog.subclasses.some((sub) => sub.id === value && sub.classId === classId));
      const subclass = subclassId ? sources.catalog.subclasses.find((sub) => sub.id === subclassId)?.name : undefined;
      return `${name}${counts.size > 1 ? ` ${level}` : ""}${subclass ? ` (${subclass})` : ""}`;
    });
    const background = build.background.id
      ? sources.catalog.backgrounds.find((entry) => entry.id === build.background.id)?.name
      : build.background.custom ? "a custom background" : undefined;
    const species = build.species ? sources.catalog.species.find((entry) => entry.id === build.species!.id)?.name : undefined;
    return { what: classes.join(" / "), level: build.levels.length, species, background };
  }
  const classes = (definition.character?.classes ?? []).filter((entry) => entry.name.trim());
  if (classes.length) {
    const named = classes.map((entry) => `${entry.name}${classes.length > 1 ? ` ${entry.level}` : ""}${entry.subclass?.name ? ` (${entry.subclass.name})` : ""}`);
    const level = definition.character?.level ?? classes.reduce((sum, entry) => sum + entry.level, 0);
    return { what: named.join(" / "), level };
  }
  return {
    what: `${capitalize(definition.size)}${definition.type ? ` ${definition.type}` : " creature"}`,
    ...(definition.challengeRating !== undefined ? { challenge: formatChallengeRating(definition.challengeRating) } : {})
  };
}

/** A built character's hit dice: "5d10 + 2d8". Undefined for anything the builder didn't make (D10). */
export function hitDiceOf(build: CharacterBuild | undefined, sources: BuildSources): string | undefined {
  if (!build) return undefined;
  const byDie = new Map<number, number>();
  for (const level of build.levels) {
    const die = sources.catalog.classes.find((entry) => entry.id === level.classId)?.hitDie;
    if (die) byDie.set(die, (byDie.get(die) ?? 0) + 1);
  }
  if (!byDie.size) return undefined;
  return [...byDie].sort(([a], [b]) => b - a).map(([die, count]) => `${count}d${die}`).join(" + ");
}
