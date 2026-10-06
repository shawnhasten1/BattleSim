import type { CreatureDefinition } from "@/engine";
import type { CharacterBuild } from "@/lib/character-builder/build-record";
import type { BuildSources } from "@/lib/character-builder/build";
import { formatChallengeRating } from "@/lib/srd-monster-tree";

/* ─── palettes (CHARACTER_SHEET_WINDOWS_PLAN.md D6) ───────────────────────── */

export type CodexPaletteId = "ember" | "parchment" | "faerie";

/**
 * A Codex palette: CSS custom properties set on the Codex's root. A palette changes colours only; the ornaments are the
 * same in each. `--panel` is what text sits on, so `--ink`, `--muted` and `--accent` are checked against it.
 */
export interface CodexPalette {
  label: string;
  dark: boolean;
  tokens: Record<`--${string}`, string>;
}

export const CODEX_PALETTES: Record<CodexPaletteId, CodexPalette> = {
  // Dark, the default: ink-black leather, parchment text, ember and gold, as the app's own shell.
  ember: {
    label: "Ember",
    dark: true,
    tokens: {
      "--bg": "#14110E", "--bg-top": "#17130F", "--bg-bot": "#100D0B",
      "--aura-1": "rgba(217,138,61,.10)", "--aura-2": "rgba(201,162,39,.07)",
      "--panel": "#1D1915", "--panel-2": "#26201A",
      "--ink": "#E8DCC4", "--muted": "#A79B88",
      "--accent": "#D98A3D", "--accent-soft": "rgba(217,138,61,.28)",
      "--gild": "#C9A227", "--gild-glow": "rgba(201,162,39,.45)",
      "--gem-hi": "#F2B66B", "--gem-lo": "#7A3F12", "--gem-ink": "#FFF6E8",
      "--good": "#C9A227", "--bad": "#C2524E", "--temp": "#6F8FB5",
      "--line": "rgba(217,138,61,.34)", "--line-soft": "rgba(232,220,196,.14)",
      "--rule": "rgba(232,220,196,.10)", "--field": "rgba(232,220,196,.05)",
      "--shadow": "rgba(0,0,0,.5)",
      "--sheen": "linear-gradient(130deg,rgba(217,138,61,.75),rgba(201,162,39,.6) 35%,rgba(138,106,58,.55) 65%,rgba(122,46,42,.6))"
    }
  },
  // Light, for daylight (and, later, printing): cream paper, iron-gall ink, oxblood and old gold.
  parchment: {
    label: "Parchment",
    dark: false,
    tokens: {
      "--bg": "#EFE6D2", "--bg-top": "#F2EAD8", "--bg-bot": "#E9DEC6",
      "--aura-1": "rgba(140,47,31,.07)", "--aura-2": "rgba(154,116,23,.08)",
      "--panel": "#F8F2E4", "--panel-2": "#F1E8D4",
      "--ink": "#2B2118", "--muted": "#6A5E4C",
      "--accent": "#8C2F1F", "--accent-soft": "rgba(140,47,31,.2)",
      "--gild": "#9A7417", "--gild-glow": "rgba(154,116,23,.35)",
      "--gem-hi": "#C0533F", "--gem-lo": "#5E1A10", "--gem-ink": "#FFF6EC",
      "--good": "#8A6A12", "--bad": "#8C2F1F", "--temp": "#3D6EA6",
      "--line": "rgba(140,47,31,.32)", "--line-soft": "rgba(43,33,24,.16)",
      "--rule": "rgba(43,33,24,.12)", "--field": "rgba(43,33,24,.045)",
      "--shadow": "rgba(60,40,20,.18)",
      "--sheen": "linear-gradient(130deg,rgba(140,47,31,.55),rgba(154,116,23,.5) 40%,rgba(90,70,40,.4))"
    }
  },
  // The original Faerie Codex's dark set, kept as it was.
  faerie: {
    label: "Faerie",
    dark: true,
    tokens: {
      "--bg": "#18122C", "--bg-top": "#1C1435", "--bg-bot": "#0D2024",
      "--aura-1": "rgba(233,160,215,.14)", "--aura-2": "rgba(130,230,200,.09)",
      "--panel": "#211A3B", "--panel-2": "#2A2149",
      "--ink": "#EFE9F8", "--muted": "#AEA5C7",
      "--accent": "#EFB4DF", "--accent-soft": "rgba(239,180,223,.3)",
      "--gild": "#9DEFD3", "--gild-glow": "rgba(157,239,211,.5)",
      "--gem-hi": "#43B497", "--gem-lo": "#1C5B58", "--gem-ink": "#F3FFFA",
      "--good": "#9DEFD3", "--bad": "#E4587A", "--temp": "#9DEFD3",
      "--line": "rgba(239,180,223,.36)", "--line-soft": "rgba(174,165,199,.18)",
      "--rule": "rgba(239,233,248,.10)", "--field": "rgba(239,233,248,.05)",
      "--shadow": "rgba(0,0,0,.45)",
      "--sheen": "linear-gradient(130deg,rgba(240,166,207,.65),rgba(157,239,211,.55) 35%,rgba(190,170,255,.55) 65%,rgba(255,220,150,.5))"
    }
  }
};

export const CODEX_PALETTE_IDS = Object.keys(CODEX_PALETTES) as CodexPaletteId[];

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
