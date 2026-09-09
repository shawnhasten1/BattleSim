import type { CombatantState, CreatureDefinition, TokenVisuals } from "@/engine";

/** Trigger a browser download of `payload` as pretty-printed JSON. */
export function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
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

/** Combatant-level token visuals win over definition-level defaults. */
export function tokenVisualsFor(definition: CreatureDefinition, combatant?: CombatantState): TokenVisuals {
  return { ...(definition.tokenVisuals ?? {}), ...(combatant?.tokenVisuals ?? {}) };
}

export function formatBonus(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

export function sourceLabel(source?: { provider?: string; documentKey?: string; documentName?: string }): string {
  if (!source) return "homebrew";
  return [source.documentName ?? source.provider, source.documentKey].filter(Boolean).join(" - ");
}
