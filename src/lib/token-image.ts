import { placeholderTokenUrl } from "@/data/srd/tokens";
import type { CombatantState, CreatureDefinition, TokenVisuals } from "@/engine";

/**
 * Where the image a token shows comes from, first hit wins (SRD_TOKEN_IMAGES_PLAN.md):
 * - `token`: this token's own upload;
 * - `creature`: its creature's upload (every token of it);
 * - `device`: art the DM imported for this SRD monster, kept in this browser only;
 * - `placeholder`: the SRD monster's bundled game-icons token.
 * None of these: the token shows its initials.
 */
export type TokenImageSource = "token" | "creature" | "device" | "placeholder";

type VisualsOwner = Pick<CreatureDefinition, "tokenVisuals" | "source">;
type DeviceImages = Readonly<Record<string, string>>;

/**
 * The SRD library monster a creature is, by its source rather than its id: a copy the user saved
 * or edited gets a fresh id but keeps `source`, so it keeps the monster's art.
 */
export function srdSlugOf(definition: Pick<CreatureDefinition, "source">): string | undefined {
  return definition.source?.provider === "srd" ? definition.source.slug || undefined : undefined;
}

export function tokenImageSource(
  definition: VisualsOwner,
  combatant?: Pick<CombatantState, "tokenVisuals">,
  deviceImages: DeviceImages = {}
): TokenImageSource | undefined {
  if (combatant?.tokenVisuals?.imageUrl) return "token";
  if (definition.tokenVisuals?.imageUrl) return "creature";
  const slug = srdSlugOf(definition);
  if (slug && deviceImages[slug]) return "device";
  if (placeholderTokenUrl(slug)) return "placeholder";
  return undefined;
}

/** A token's look: the creature's defaults, then the token's own, with the image resolved down the list above. */
export function resolveTokenVisuals(
  definition: VisualsOwner,
  combatant?: Pick<CombatantState, "tokenVisuals">,
  deviceImages: DeviceImages = {}
): TokenVisuals {
  const visuals: TokenVisuals = { ...(definition.tokenVisuals ?? {}), ...(combatant?.tokenVisuals ?? {}) };
  if (visuals.imageUrl) return visuals;
  const slug = srdSlugOf(definition);
  const imageUrl = (slug ? deviceImages[slug] : undefined) ?? placeholderTokenUrl(slug);
  return imageUrl ? { ...visuals, imageUrl } : visuals;
}
