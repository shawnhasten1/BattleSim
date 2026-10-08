import manifest from "./monsters/generated/token-icons.json";

/**
 * The placeholder token every bundled SRD monster ships with: a game-icons.net glyph on a disc
 * coloured by creature type, built by `npm run srd:tokens` into `public/tokens/srd/<slug>.svg`.
 * See SRD_TOKEN_IMAGES_PLAN.md.
 */

interface TokenIconManifest {
  source: string;
  license: { title: string; url: string };
  authors: Array<{ folder: string; name: string; url?: string }>;
  monsters: Record<string, string>;
  /** The character builder's icons, by `"<group>/<name>"` (CHARACTER_BUILDER_UX_PLAN.md D14). */
  builder: Record<string, string>;
}

const TOKENS = manifest as TokenIconManifest;

/** Who made the icons the placeholder tokens use, for the CC BY 3.0 credit. */
export const SRD_TOKEN_ICON_CREDITS = {
  source: TOKENS.source,
  license: TOKENS.license,
  authors: TOKENS.authors
} as const;

/**
 * The builder's icon for an SRD class, species or spell school (`srd:class:wizard-2014` and `srd:class:wizard` share
 * the Wizard's; a school by its name), as a URL under `public/icons/builder`. Undefined for homebrew or anything without.
 */
export function builderIconUrl(group: "class" | "species" | "school", idOrName: string | undefined): string | undefined {
  if (!idOrName) return undefined;
  if (group !== "school" && !idOrName.startsWith("srd:")) return undefined;
  const name = idOrName.slice(idOrName.lastIndexOf(":") + 1).replace(/-2014$/, "").toLowerCase();
  const key = `${group}/${name}`;
  return Object.hasOwn(TOKENS.builder, key) ? `/icons/builder/${group}-${name}.svg` : undefined;
}

/** The placeholder token for a library monster's slug, or undefined for one without a token. */
export function placeholderTokenUrl(slug: string | undefined): string | undefined {
  return slug && Object.hasOwn(TOKENS.monsters, slug) ? `/tokens/srd/${slug}.svg` : undefined;
}
