/**
 * Matches imported token art to SRD monsters by file name (SRD_TOKEN_IMAGES_PLAN.md, phase 3).
 *
 * Token packs name files every which way: "Ancient_Red_Dragon_Token_01.webp",
 * "Dragon-Red-Ancient.png", "AncientRedDragon_Large_Scale.png". Both sides are reduced to a bag
 * of words with pack noise dropped (token, sizes, variant numbers), then compared:
 * - **exact**: the same words, in any order (or the same letters, however they're spaced);
 * - **suggested**: the closest monster when they share most of their words (shown for the DM to confirm);
 * - **unmatched**: anything else (the DM can pick a monster by hand).
 * When several files match one monster, the first (by file name) wins and the rest are `duplicate`.
 */

export interface TokenMatchTarget {
  slug: string;
  name: string;
}

export type TokenMatchKind = "exact" | "suggested" | "unmatched";

export interface TokenFileMatch {
  /** Index into the file list given to `matchTokenFiles`. */
  index: number;
  fileName: string;
  slug?: string;
  kind: TokenMatchKind;
  /** Another file already matches this monster at least as well. */
  duplicate?: boolean;
}

/** The share of words two names must have in common to be suggested (Dice coefficient). */
export const SUGGEST_THRESHOLD = 0.6;

const NOISE = new Set([
  "token", "tokens", "topdown", "top", "down", "overhead", "portrait", "art", "image", "img", "icon",
  "scale", "scaled", "round", "circle", "border", "ring", "base", "frame",
  "tiny", "small", "medium", "large", "huge", "gargantuan",
  "the", "of", "a", "an", "and",
  "png", "jpg", "jpeg", "webp", "gif", "avif",
  "final", "copy", "hd", "alt", "var", "variant", "version", "fa", "2mt"
]);

/** Variant and size codes: "01", "a1", "v2", "256px", "x2", "2x". */
const CODE = /^(\d+|[a-z]\d+|v\d+|\d+px|x\d+|\d+x)$/;

/**
 * Library entries that are the same creature under two names: art for one is art for both.
 */
export const TWIN_SLUGS: Readonly<Record<string, readonly string[]>> = {
  "deep-gnome-svirfneblin": ["gnome-deep-svirfneblin"],
  "gnome-deep-svirfneblin": ["deep-gnome-svirfneblin"],
  drow: ["elf-drow"],
  "elf-drow": ["drow"]
};

/** A file or monster name as its meaningful words, lower case. */
export function nameWords(text: string): string[] {
  const base = text.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{2,5}$/i, "");
  return base
    .replace(/'/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !NOISE.has(word) && !CODE.test(word));
}

function dice(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function sameWords(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((word) => b.has(word));
}

/** The monster a file name is for, if any. */
export function matchTokenFile(fileName: string, targets: readonly TokenMatchTarget[]): { slug?: string; kind: TokenMatchKind; score: number } {
  const list = nameWords(fileName);
  const words = new Set(list);
  if (words.size === 0) return { kind: "unmatched", score: 0 };
  // "Owl Bear" is the Owlbear and "Sabertoothed Tiger" the Saber-Toothed Tiger: spacing doesn't matter.
  const run = list.join("");
  let best: { target: TokenMatchTarget; score: number; extra: number } | undefined;
  for (const target of targets) {
    const targetList = nameWords(target.name);
    const targetWords = new Set(targetList);
    if (sameWords(words, targetWords) || run === targetList.join("")) return { slug: target.slug, kind: "exact", score: 1 };
    const score = dice(words, targetWords);
    const extra = targetWords.size - words.size;
    // Ties go to the name closest in length, then to the first in `targets`; the DM confirms a suggestion either way.
    if (!best || score > best.score || (score === best.score && Math.abs(extra) < Math.abs(best.extra))) {
      best = { target, score, extra };
    }
  }
  return best && best.score >= SUGGEST_THRESHOLD
    ? { slug: best.target.slug, kind: "suggested", score: best.score }
    : { kind: "unmatched", score: best?.score ?? 0 };
}

/** Match every file; see the module comment. */
export function matchTokenFiles(fileNames: readonly string[], targets: readonly TokenMatchTarget[]): TokenFileMatch[] {
  const matches = fileNames.map((fileName, index) => ({ index, fileName, ...matchTokenFile(fileName, targets) }));
  // Exact beats suggested; then file name order. The best file for each monster is the one that's used.
  const order = [...matches].sort(
    (a, b) => Number(b.kind === "exact") - Number(a.kind === "exact") || b.score - a.score
      || a.fileName.localeCompare(b.fileName, undefined, { numeric: true })
  );
  const taken = new Set<string>();
  const duplicates = new Set<number>();
  for (const match of order) {
    if (!match.slug) continue;
    if (taken.has(match.slug)) duplicates.add(match.index);
    else taken.add(match.slug);
  }
  return matches.map(({ score: _score, ...match }) => (duplicates.has(match.index) ? { ...match, duplicate: true } : match));
}
