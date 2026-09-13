"use client";

import { Search, Swords, Trash2, Upload, UserPlus } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { abilityModifier, parseCombatantPackage, type Ability, type CreatureDefinition, type DamageType } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import type { Compendium } from "@/hooks/useCompendium";
import { formatBonus } from "@/lib/ui-helpers";
import { Modal } from "@/components/ui/Modal";
import { SelectAbility, SelectDamageType } from "@/components/sheet/SheetControls";
import styles from "./modals.module.css";

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

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
  /** When set, every actor created through this modal is filed into this folder automatically. */
  targetFolderId?: string | null;
}

export function CreateTokenModal({ compendium, onClose, targetFolderId }: CreateTokenModalProps) {
  const encounter = useEncounterStore((s) => s.encounter);
  const definitionsLibrary = useEncounterStore((s) => s.definitionsLibrary);
  const actorFolders = useEncounterStore((s) => s.actorFolders);
  const addCustomToken = useEncounterStore((s) => s.addCustomToken);
  const addLibraryDefinitionToEncounter = useEncounterStore((s) => s.addLibraryDefinitionToEncounter);
  const deleteLibraryDefinition = useEncounterStore((s) => s.deleteLibraryDefinition);
  const importCombatantPackage = useEncounterStore((s) => s.importCombatantPackage);
  const moveDefinitionToFolder = useEncounterStore((s) => s.moveDefinitionToFolder);

  const targetFolderName = targetFolderId
    ? actorFolders.find((folder) => folder.id === targetFolderId)?.name
    : undefined;

  const [form, setForm] = useState({
    name: "Bandit",
    faction: "enemy" as "party" | "enemy",
    ac: 13,
    hp: 11,
    speed: 30,
    proficiencyBonus: 2,
    attackName: "Scimitar",
    attackType: "melee" as "melee" | "ranged",
    attackAbility: "str" as Ability,
    damageDice: "1d6",
    damageType: "slashing" as DamageType,
    abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 } as CreatureDefinition["abilities"]
  });
  const [query, setQuery] = useState("goblin");
  const [results, setResults] = useState<CreatureSearchResult[]>([]);

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
      if (targetFolderId) void moveDefinitionToFolder(newId, targetFolderId);
      compendium.setStatus(`Imported ${payload.combatant?.displayName ?? payload.definition.name}`);
      onClose();
    } catch (error) {
      compendium.setStatus(error instanceof Error ? error.message : "Token import failed");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <Modal open onClose={onClose} title="Create Token">
      <div className={styles.form}>
        {targetFolderId ? (
          <p className={styles.status}>Adding to folder: <strong>{targetFolderName ?? "Unknown folder"}</strong></p>
        ) : null}
        <label className={styles.upload}>
          <Upload size={14} /> Import Player / Enemy JSON
          <input type="file" accept="application/json" onChange={importJson} />
        </label>

        <h4>Custom token</h4>
        <div className={styles.grid2}>
          <label className={styles.field}>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className={styles.field}>
            Faction
            <select value={form.faction} onChange={(e) => setForm({ ...form, faction: e.target.value as "party" | "enemy" })}>
              <option value="party">Party</option>
              <option value="enemy">Enemy</option>
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

        <h4>Primary attack</h4>
        <div className={styles.grid2}>
          <label className={styles.field}>Name<input value={form.attackName} onChange={(e) => setForm({ ...form, attackName: e.target.value })} /></label>
          <label className={styles.field}>
            Type
            <select value={form.attackType} onChange={(e) => setForm({ ...form, attackType: e.target.value as "melee" | "ranged" })}>
              <option value="melee">Melee</option>
              <option value="ranged">Ranged</option>
            </select>
          </label>
          <label className={styles.field}>Ability<SelectAbility value={form.attackAbility} onChange={(attackAbility) => setForm({ ...form, attackAbility })} /></label>
          <label className={styles.field}>Damage<input value={form.damageDice} onChange={(e) => setForm({ ...form, damageDice: e.target.value })} /></label>
          <label className={styles.field}>Damage type<SelectDamageType value={form.damageType} onChange={(damageType) => setForm({ ...form, damageType })} /></label>
        </div>
        <button
          type="button"
          className={styles.primary}
          onClick={() => {
            const newId = addCustomToken(form);
            if (targetFolderId) void moveDefinitionToFolder(newId, targetFolderId);
            setForm({ ...form, name: `${form.faction === "party" ? "PC" : "Enemy"} ${encounter.combatants.length + 1}` });
            onClose();
          }}
        >
          <UserPlus size={14} /> Create custom token
        </button>

        {definitionsLibrary.length > 0 ? (
          <>
            <h4>Definition library</h4>
            <div className={styles.list}>
              {definitionsLibrary.map((definition) => (
                <div key={definition.id}>
                  <button
                    type="button"
                    className={styles.listMain}
                    onClick={() => {
                      addLibraryDefinitionToEncounter(definition.id, "party");
                      onClose();
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
                      onClose();
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
          </>
        ) : null}

        <h4>Open5e creature</h4>
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
      </div>
    </Modal>
  );
}
