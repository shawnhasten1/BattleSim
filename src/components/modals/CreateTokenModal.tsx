"use client";

import { Search, Swords, Trash2, Upload, UserPlus } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { abilityModifier, parseCombatantPackage, type Ability, type CreatureDefinition, type CreatureType, type SizeCategory } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import type { Compendium } from "@/hooks/useCompendium";
import { formatBonus } from "@/lib/ui-helpers";
import { CREATURE_TYPES } from "@/lib/creature-types";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import styles from "./modals.module.css";

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const SIZES: SizeCategory[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];

interface CreatureSearchResult {
  key: string;
  slug: string;
  name: string;
  documentKey?: string;
  documentTitle?: string;
}

interface CreateTokenModalProps {
  compendium: Compendium;
  onClose: () => void;
  /** Called after a token is created/imported/added, in addition to onClose — used to pop the actor sheet open on it. */
  onCreated?: () => void;
  /** When set, every actor created through this modal is filed into this folder automatically. */
  targetFolderId?: string | null;
}

const TABS = [
  { id: "custom", label: "Custom" },
  { id: "library", label: "Library" },
  { id: "open5e", label: "Open5e" },
  { id: "import", label: "Import" }
] as const;
type TabId = (typeof TABS)[number]["id"];

export function CreateTokenModal({ compendium, onClose, onCreated, targetFolderId }: CreateTokenModalProps) {
  const definitionsLibrary = useEncounterStore((s) => s.definitionsLibrary);
  const actorFolders = useEncounterStore((s) => s.actorFolders);
  const addBlankToken = useEncounterStore((s) => s.addBlankToken);
  const addLibraryDefinitionToEncounter = useEncounterStore((s) => s.addLibraryDefinitionToEncounter);
  const deleteLibraryDefinition = useEncounterStore((s) => s.deleteLibraryDefinition);
  const importCombatantPackage = useEncounterStore((s) => s.importCombatantPackage);
  const moveDefinitionToFolder = useEncounterStore((s) => s.moveDefinitionToFolder);

  const [tab, setTab] = useState<TabId>("custom");

  const targetFolderName = targetFolderId
    ? actorFolders.find((folder) => folder.id === targetFolderId)?.name
    : undefined;

  const [form, setForm] = useState({
    name: "New Actor",
    faction: "enemy" as "party" | "enemy",
    size: "medium" as SizeCategory,
    type: undefined as CreatureType | undefined,
    ac: 13,
    hp: 11,
    speed: 30,
    proficiencyBonus: 2,
    abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 } as CreatureDefinition["abilities"]
  });
  const [query, setQuery] = useState("goblin");
  const [results, setResults] = useState<CreatureSearchResult[]>([]);

  function finish(newId?: string) {
    if (newId && targetFolderId) void moveDefinitionToFolder(newId, targetFolderId);
    onCreated?.();
    onClose();
  }

  async function searchCreatures() {
    compendium.setStatus("Searching");
    const response = await fetch(`/api/open5e/creatures?query=${encodeURIComponent(query)}&limit=10`);
    if (!response.ok) {
      compendium.setStatus("Search failed");
      return;
    }
    const data = (await response.json()) as { results: CreatureSearchResult[] };
    setResults(data.results);
    compendium.setStatus(`${data.results.length} results`);
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = parseCombatantPackage(JSON.parse(await file.text()));
      const newId = importCombatantPackage(payload);
      compendium.setStatus(`Imported ${payload.combatant?.displayName ?? payload.definition.name}`);
      finish(newId);
    } catch (error) {
      compendium.setStatus(error instanceof Error ? error.message : "Token import failed");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <FloatingWindow title="Create Token" ariaLabel="Create token" width={360} storageKey="create-token" onClose={onClose}>
      <div className={styles.form}>
        {targetFolderId ? (
          <p className={styles.status}>Adding to folder: <strong>{targetFolderName ?? "Unknown folder"}</strong></p>
        ) : null}

        <div className={styles.tabs} role="tablist" aria-label="Create token sections">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === tab}
              className={entry.id === tab ? styles.active : ""}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {tab === "custom" ? (
          <>
            <div className={styles.grid2}>
              <label className={styles.field}>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label className={styles.field}>
                Faction
                <select value={form.faction} onChange={(e) => setForm({ ...form, faction: e.target.value as "party" | "enemy" })}>
                  <option value="party">Party</option>
                  <option value="enemy">Enemy</option>
                </select>
              </label>
              <label className={styles.field}>
                Size
                <select value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value as SizeCategory })}>
                  {SIZES.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Type
                <select
                  value={form.type ?? ""}
                  onChange={(e) => setForm({ ...form, type: e.target.value ? (e.target.value as CreatureType) : undefined })}
                >
                  <option value="">Unspecified</option>
                  {CREATURE_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>AC<input type="number" value={form.ac} onChange={(e) => setForm({ ...form, ac: Number(e.target.value) })} /></label>
              <label className={styles.field}>HP<input type="number" value={form.hp} onChange={(e) => setForm({ ...form, hp: Number(e.target.value) })} /></label>
              <label className={styles.field}>Speed<input type="number" value={form.speed} onChange={(e) => setForm({ ...form, speed: Number(e.target.value) })} /></label>
              <label className={styles.field}>Proficiency<input type="number" value={form.proficiencyBonus} onChange={(e) => setForm({ ...form, proficiencyBonus: Number(e.target.value) })} /></label>
            </div>

            <div className={styles.abilities}>
              {ABILITIES.map((ability) => (
                <label key={ability}>
                  <span>{ability}</span>
                  <input
                    type="number"
                    value={form.abilities[ability]}
                    onChange={(e) => setForm({ ...form, abilities: { ...form.abilities, [ability]: Number(e.target.value) } })}
                  />
                  <strong>{formatBonus(abilityModifier(form.abilities[ability]))}</strong>
                </label>
              ))}
            </div>

            <p className={styles.status}>Weapons, spells, multiattack, and features are added next, on the actor sheet.</p>

            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                const newId = addBlankToken(form);
                setForm({ ...form, name: "New Actor" });
                finish(newId);
              }}
            >
              <UserPlus size={14} /> Create token
            </button>
          </>
        ) : null}

        {tab === "library" ? (
          definitionsLibrary.length > 0 ? (
            <div className={styles.list}>
              {definitionsLibrary.map((definition) => (
                <div key={definition.id}>
                  <button
                    type="button"
                    className={styles.listMain}
                    onClick={() => {
                      addLibraryDefinitionToEncounter(definition.id, "party");
                      finish();
                    }}
                  >
                    <strong>{definition.name}</strong>
                    <span>{definition.source?.documentName ?? definition.source?.provider ?? "homebrew"}</span>
                  </button>
                  <button
                    type="button"
                    title="Add as enemy"
                    onClick={() => {
                      addLibraryDefinitionToEncounter(definition.id, "enemy");
                      finish();
                    }}
                  >
                    <Swords size={13} />
                  </button>
                  <button type="button" title="Delete" onClick={() => void deleteLibraryDefinition(definition.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.status}>No saved definitions yet.</p>
          )
        ) : null}

        {tab === "open5e" ? (
          <>
            <div className={styles.searchRow}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void searchCreatures(); }} />
              <button type="button" onClick={() => void searchCreatures()} title="Search Open5e">
                <Search size={14} />
              </button>
            </div>
            {compendium.status ? <p className={styles.status}>{compendium.status}</p> : null}
            <div className={styles.list}>
              {results.map((result, index) => (
                <div key={result.key || `${result.documentKey ?? "doc"}-${result.slug}-${index}`}>
                  <button
                    type="button"
                    className={styles.listMain}
                    onClick={() => {
                      void compendium.importCreature(result.slug, undefined, targetFolderId);
                    }}
                  >
                    <strong>{result.name}</strong>
                    <span>{result.documentTitle ?? result.documentKey ?? "Open5e"}</span>
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {tab === "import" ? (
          <label className={styles.upload}>
            <Upload size={14} /> Import Player / Enemy JSON
            <input type="file" accept="application/json" onChange={importJson} />
          </label>
        ) : null}
      </div>
    </FloatingWindow>
  );
}
