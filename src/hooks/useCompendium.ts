import { useState } from "react";
import type { CreatureDefinition, FeatureDefinition, ItemDefinition, SpellDefinition, WeaponDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import {
  featureFromCompendiumPayload,
  type CompendiumCategory,
  type CompendiumPayload,
  type CompendiumSearchResult
} from "@/lib/compendium";

interface UseCompendiumOptions {
  /** Called after a creature import succeeds (used to dismiss the Create modal). */
  onCreatureImported?: () => void;
}

/**
 * Open5e search and import: creatures for the Create Token modal, and spells and items for a sheet's Add ability. Its
 * status messages show as a toast on the sheet in front.
 */
export function useCompendium({ onCreatureImported }: UseCompendiumOptions = {}) {
  const addCreatureDefinition = useEncounterStore((state) => state.addCreatureDefinition);
  const moveDefinitionToFolder = useEncounterStore((state) => state.moveDefinitionToFolder);
  const attachSpellDefinition = useEncounterStore((state) => state.attachSpellDefinition);
  const attachWeaponDefinition = useEncounterStore((state) => state.attachWeaponDefinition);
  const attachFeatureDefinition = useEncounterStore((state) => state.attachFeatureDefinition);
  const insertAbilityRecord = useEncounterStore((state) => state.insertAbilityRecord);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CompendiumSearchResult[]>([]);
  const [status, setStatus] = useState("");

  /** Search a category; `text` searches for that instead of the query box (set in the same click, before it re-renders). */
  async function search(category: CompendiumCategory, text = query) {
    setStatus("Searching compendium");
    const params = new URLSearchParams({ query: text, category, limit: "18" });
    const response = await fetch(`/api/open5e/compendium?${params.toString()}`);
    if (!response.ok) {
      setStatus("Compendium search failed");
      return;
    }
    const data = (await response.json()) as { results: CompendiumSearchResult[] };
    setResults(data.results);
    setStatus(`${data.results.length} compendium results`);
  }

  async function importCreature(slug: string, position?: { x: number; y: number }, folderId?: string | null) {
    setStatus("Importing");
    const response = await fetch(`/api/open5e/creatures/${encodeURIComponent(slug)}`);
    if (!response.ok) {
      setStatus("Import failed");
      return;
    }
    const data = (await response.json()) as { definition?: CreatureDefinition; error?: string };
    if (!data.definition?.id) {
      setStatus(data.error ?? "Import returned no creature definition");
      return;
    }
    addCreatureDefinition(data.definition, "enemy", position);
    if (folderId) void moveDefinitionToFolder(data.definition.id, folderId);
    setStatus("Imported as mapped creature");
    onCreatureImported?.();
  }

  async function importSpell(slug: string, definitionId: string) {
    setStatus("Importing spell");
    const response = await fetch(`/api/open5e/spells/${encodeURIComponent(slug)}`);
    if (!response.ok) {
      setStatus("Spell import failed");
      return;
    }
    const data = (await response.json()) as { spell?: SpellDefinition; error?: string };
    if (!data.spell?.id) {
      setStatus(data.error ?? "Import returned no spell");
      return;
    }
    attachSpellDefinition(definitionId, data.spell);
    setStatus("Spell attached as reference-only");
  }

  async function importCompendiumContent(
    payload: CompendiumPayload
  ): Promise<{ weapon?: WeaponDefinition; item?: ItemDefinition; feature?: FeatureDefinition } | null> {
    if (!payload.route || !payload.objectKey) {
      return { feature: featureFromCompendiumPayload(payload) };
    }
    const params = new URLSearchParams({ route: payload.route, key: payload.objectKey });
    const response = await fetch(`/api/open5e/compendium/content?${params.toString()}`);
    if (!response.ok) {
      setStatus("Compendium import failed");
      return null;
    }
    return (await response.json()) as { weapon?: WeaponDefinition; item?: ItemDefinition; feature?: FeatureDefinition };
  }

  /** An Open5e item or weapon onto a creature: a structured attack when it's a weapon, otherwise carried for reference. */
  async function attach(payload: CompendiumPayload, definitionId: string) {
    const imported = await importCompendiumContent(payload);
    if (imported?.weapon) {
      attachWeaponDefinition(definitionId, imported.weapon);
      setStatus("Weapon attached as structured attack");
      return;
    }
    if (imported?.item) {
      insertAbilityRecord(definitionId, "items", imported.item);
      setStatus(`${imported.item.name} carried for reference: the DM applies it`);
      return;
    }
    if (imported?.feature) {
      attachFeatureDefinition(definitionId, imported.feature);
      setStatus("Item attached as manual-only reference");
      return;
    }
    setStatus("Item import returned no supported content");
  }

  return {
    query,
    setQuery,
    results,
    status,
    setStatus,
    search,
    attach,
    importCreature,
    importSpell
  };
}

export type Compendium = ReturnType<typeof useCompendium>;
