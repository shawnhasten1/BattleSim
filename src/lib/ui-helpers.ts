import type { CombatantState, CreatureDefinition, TokenVisuals } from "@/engine";
import { resolveTokenVisuals } from "@/lib/token-image";

/** Trigger a browser download of `payload` as pretty-printed JSON. */
/**
 * Download `payload` as a JSON file. `from` is the document the click was in: a popped-out sheet's, so the download
 * starts in the window the DM is using (a browser only lets the window that was clicked start one).
 */
export function downloadJson(filename: string, payload: unknown, from: Document = document): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = from.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function safeFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "combatant";
}

/** Player-authored definitions default to the party; everything else to enemies. */
export function defaultFactionForDefinition(definition: CreatureDefinition): "party" | "enemy" {
  return definition.character ? "party" : "enemy";
}

/**
 * Combatant-level token visuals win over definition-level defaults; with no image of their own, an
 * SRD monster shows this browser's imported art for it (`deviceImages`) or its placeholder token.
 */
export function tokenVisualsFor(
  definition: Pick<CreatureDefinition, "tokenVisuals" | "source">,
  combatant?: Pick<CombatantState, "tokenVisuals">,
  deviceImages?: Readonly<Record<string, string>>
): TokenVisuals {
  return resolveTokenVisuals(definition, combatant, deviceImages);
}

export function formatBonus(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

export function sourceLabel(source?: { provider?: string; documentKey?: string; documentName?: string }): string {
  if (!source) return "homebrew";
  return [source.documentName ?? source.provider, source.documentKey].filter(Boolean).join(" - ");
}
