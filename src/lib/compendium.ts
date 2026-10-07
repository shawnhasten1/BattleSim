import type { FeatureDefinition } from "@/engine";
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

/** What an import needs from a search result. */
export type CompendiumPayload = Pick<
  CompendiumSearchResult,
  "objectKey" | "slug" | "name" | "resource" | "model" | "route" | "level" | "documentKey" | "documentTitle" | "text"
>;

export function featureFromCompendiumPayload(payload: CompendiumPayload): FeatureDefinition {
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
