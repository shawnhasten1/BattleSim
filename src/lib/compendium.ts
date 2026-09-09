import type { ConditionName, FeatureDefinition } from "@/engine";
import { safeFileName } from "@/lib/ui-helpers";

export type CompendiumCategory = "all" | "creatures" | "spells" | "items" | "features" | "conditions";
export type CompendiumResource = "creature" | "spell" | "item" | "weapon" | "feature" | "condition" | "rule";

export interface CompendiumSearchResult {
  key: string;
  objectKey: string;
  slug: string;
  name: string;
  resource: CompendiumResource;
  model?: string;
  route?: string;
  level?: number;
  documentKey?: string;
  documentTitle?: string;
  text?: string;
  highlighted?: string;
}

export type CompendiumDragPayload = Pick<
  CompendiumSearchResult,
  "objectKey" | "slug" | "name" | "resource" | "model" | "route" | "level" | "documentKey" | "documentTitle" | "text"
>;

export const COMPENDIUM_CATEGORIES: Array<{ id: CompendiumCategory; label: string }> = [
  { id: "creatures", label: "Creatures" },
  { id: "spells", label: "Spells" },
  { id: "items", label: "Items" },
  { id: "features", label: "Features" },
  { id: "conditions", label: "Conditions" },
  { id: "all", label: "All" }
];

/** Conditions the engine can apply automatically (others are reference-only). */
export const SUPPORTED_CONDITIONS: ConditionName[] = [
  "blinded",
  "charmed",
  "deafened",
  "frightened",
  "grappled",
  "incapacitated",
  "invisible",
  "paralyzed",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious"
];

export function conditionFromCompendiumName(name: string): ConditionName | undefined {
  const normalized = name.trim().toLowerCase();
  return SUPPORTED_CONDITIONS.find((condition) => condition === normalized);
}

export function featureFromCompendiumPayload(payload: CompendiumDragPayload): FeatureDefinition {
  const documentKey = payload.documentKey ?? "unknown";
  const sourceKey = payload.objectKey || payload.slug || safeFileName(payload.name);
  return {
    id: `open5e:${documentKey}:${sourceKey}:feature`,
    name: payload.name,
    category: payload.resource === "condition" ? "trait" : "feature",
    description: payload.text,
    automationSupport: "manual-only",
    source: {
      provider: "open5e",
      documentKey: payload.documentKey,
      documentName: payload.documentTitle,
      slug: sourceKey,
      importedAt: new Date().toISOString()
    }
  };
}

export function compendiumMeta(result: CompendiumSearchResult): string {
  const resource = result.resource === "rule" ? "Rule" : result.resource[0]?.toUpperCase() + result.resource.slice(1);
  const detail = result.resource === "spell" ? `level ${result.level ?? 0}` : result.model;
  return [resource, detail, result.documentTitle ?? result.documentKey ?? "Open5e"].filter(Boolean).join(" - ");
}

export function stripMarkup(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function compendiumSnippet(value: string): string {
  const cleaned = stripMarkup(value);
  return cleaned.length > 132 ? `${cleaned.slice(0, 129)}...` : cleaned;
}
