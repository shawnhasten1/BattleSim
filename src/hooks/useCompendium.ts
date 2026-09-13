import { useState, type DragEvent } from "react";
import type { CreatureDefinition, FeatureDefinition, SpellDefinition, WeaponDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { useSelectedCombatant } from "@/hooks/useSelectedCombatant";
import {
  conditionFromCompendiumName,
  featureFromCompendiumPayload,
  type CompendiumCategory,
  type CompendiumDragPayload,
  type CompendiumSearchResult
} from "@/lib/compendium";

interface UseCompendiumOptions {
  /** Called after a creature import succeeds (used to dismiss the Create modal). */
  onCreatureImported?: () => void;
}

/**
 * The SRD / Open5e compendium subsystem: search state plus the import actions
 * that turn a dragged or clicked result into structured content on the
 * selected actor (or a token on the map). Shared by the Compendium panel, the
 * actor-sheet drop zone, and the canvas drop target.
 */
export function useCompendium({ onCreatureImported }: UseCompendiumOptions = {}) {
  const addCreatureDefinition = useEncounterStore((state) => state.addCreatureDefinition);
  const moveDefinitionToFolder = useEncounterStore((state) => state.moveDefinitionToFolder);
  const attachSpellDefinition = useEncounterStore((state) => state.attachSpellDefinition);
  const attachWeaponDefinition = useEncounterStore((state) => state.attachWeaponDefinition);
  const attachFeatureDefinition = useEncounterStore((state) => state.attachFeatureDefinition);
  const applyConditionToCombatant = useEncounterStore((state) => state.applyConditionToCombatant);
  const { selectedCombatant, selectedDefinition } = useSelectedCombatant();

  const [tab, setTab] = useState<CompendiumCategory>("creatures");
  const [query, setQuery] = useState("goblin");
  const [documentKey, setDocumentKey] = useState("");
  const [results, setResults] = useState<CompendiumSearchResult[]>([]);
  const [status, setStatus] = useState("");

  async function search(category = tab) {
    setStatus("Searching compendium");
    const params = new URLSearchParams({ query, category, limit: "18" });
    if (documentKey.trim()) {
      params.set("documentKey", documentKey.trim());
    }
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

  async function importSpell(slug: string, definitionId = selectedDefinition?.id) {
    if (!definitionId) {
      setStatus("Select a token sheet first");
      return;
    }
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
    payload: CompendiumDragPayload
  ): Promise<{ weapon?: WeaponDefinition; feature?: FeatureDefinition } | null> {
    if (!payload.route || !payload.objectKey) {
      return { feature: featureFromCompendiumPayload(payload) };
    }
    const params = new URLSearchParams({ route: payload.route, key: payload.objectKey });
    const response = await fetch(`/api/open5e/compendium/content?${params.toString()}`);
    if (!response.ok) {
      setStatus("Compendium import failed");
      return null;
    }
    return (await response.json()) as { weapon?: WeaponDefinition; feature?: FeatureDefinition };
  }

  async function attach(
    payload: CompendiumDragPayload,
    definitionId = selectedDefinition?.id,
    combatantId = selectedCombatant?.id
  ) {
    if (!definitionId && payload.resource !== "condition") {
      setStatus("Select a token sheet first");
      return;
    }
    if (payload.resource === "creature") {
      await importCreature(payload.slug || payload.objectKey);
      return;
    }
    if (payload.resource === "spell") {
      await importSpell(payload.slug || payload.objectKey, definitionId);
      return;
    }
    if (payload.resource === "condition") {
      if (!combatantId) {
        setStatus("Select a token before applying a condition");
        return;
      }
      const condition = conditionFromCompendiumName(payload.name);
      if (!condition) {
        setStatus(`${payload.name} is manual-only`);
        return;
      }
      applyConditionToCombatant(combatantId, condition);
      setStatus(`${payload.name} applied`);
      return;
    }
    if (!definitionId) {
      return;
    }
    if (payload.resource === "item" || payload.resource === "weapon") {
      const imported = await importCompendiumContent(payload);
      if (imported?.weapon) {
        attachWeaponDefinition(definitionId, imported.weapon);
        setStatus("Weapon attached as structured attack");
        return;
      }
      if (imported?.feature) {
        attachFeatureDefinition(definitionId, imported.feature);
        setStatus("Item attached as manual-only reference");
        return;
      }
      setStatus("Item import returned no supported content");
      return;
    }
    attachFeatureDefinition(definitionId, featureFromCompendiumPayload(payload));
    setStatus("Feature attached as manual-only reference");
  }

  function onDragStart(event: DragEvent<HTMLElement>, result: CompendiumSearchResult) {
    const payload: CompendiumDragPayload = {
      objectKey: result.objectKey,
      slug: result.slug,
      name: result.name,
      resource: result.resource,
      model: result.model,
      route: result.route,
      level: result.level,
      documentKey: result.documentKey,
      documentTitle: result.documentTitle,
      text: result.text
    };
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-battle-sim-compendium", JSON.stringify(payload));
  }

  return {
    tab,
    setTab,
    query,
    setQuery,
    documentKey,
    setDocumentKey,
    results,
    status,
    setStatus,
    search,
    attach,
    importCreature,
    importSpell,
    onDragStart
  };
}

export type Compendium = ReturnType<typeof useCompendium>;
