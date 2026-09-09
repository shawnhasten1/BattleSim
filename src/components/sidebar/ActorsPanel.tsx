"use client";

import { Copy, Download, FolderOpen, Save, Swords, Trash2, UserPlus, Users } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import { ENCOUNTER_SCHEMA_VERSION, type CombatantExportPackage, type CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { useSelectedCombatant } from "@/hooks/useSelectedCombatant";
import type { Compendium } from "@/hooks/useCompendium";
import type { CompendiumDragPayload } from "@/lib/compendium";
import { ActorThumbnail } from "@/components/ActorThumbnail";
import { defaultFactionForDefinition, downloadJson, safeFileName } from "@/lib/ui-helpers";
import styles from "./ActorsPanel.module.css";

interface ActorsPanelProps {
  compendium: Compendium;
  onOpenCreate: () => void;
  onOpenSheet: () => void;
}

export function ActorsPanel({ compendium, onOpenCreate, onOpenSheet }: ActorsPanelProps) {
  const encounter = useEncounterStore((state) => state.encounter);
  const definitionsLibrary = useEncounterStore((state) => state.definitionsLibrary);
  const definitionStatus = useEncounterStore((state) => state.definitionStatus);
  const addCreatureDefinition = useEncounterStore((state) => state.addCreatureDefinition);
  const addLibraryDefinitionToEncounter = useEncounterStore((state) => state.addLibraryDefinitionToEncounter);
  const deleteLibraryDefinition = useEncounterStore((state) => state.deleteLibraryDefinition);
  const saveDefinition = useEncounterStore((state) => state.saveDefinition);
  const saveSelectedDefinition = useEncounterStore((state) => state.saveSelectedDefinition);
  const loadDefinitionsLibrary = useEncounterStore((state) => state.loadDefinitionsLibrary);
  const duplicateSelected = useEncounterStore((state) => state.duplicateSelected);
  const removeCombatant = useEncounterStore((state) => state.removeCombatant);
  const { selectedCombatant, selectedDefinition } = useSelectedCombatant();

  const [dropActive, setDropActive] = useState(false);

  const savedDefinitionIds = useMemo(
    () => new Set(definitionsLibrary.map((definition) => definition.id)),
    [definitionsLibrary]
  );
  const directory = useMemo(() => {
    const byId = new Map<string, CreatureDefinition>();
    for (const definition of definitionsLibrary) byId.set(definition.id, definition);
    for (const definition of encounter.definitions) byId.set(definition.id, definition);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [definitionsLibrary, encounter.definitions]);

  function onActorDragStart(event: DragEvent<HTMLElement>, definition: CreatureDefinition) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      "application/x-battle-sim-actor",
      JSON.stringify({ definitionId: definition.id, faction: defaultFactionForDefinition(definition) })
    );
  }

  function addToEncounter(definition: CreatureDefinition, faction: "party" | "enemy") {
    if (savedDefinitionIds.has(definition.id)) {
      addLibraryDefinitionToEncounter(definition.id, faction);
    } else {
      addCreatureDefinition(definition, faction);
    }
  }

  function exportSelected() {
    if (!selectedCombatant || !selectedDefinition) return;
    const { id, definitionId, initiative, actionEconomy, concentration, ...combatant } = selectedCombatant;
    const payload: CombatantExportPackage = {
      kind: "battle-sim-combatant",
      schemaVersion: ENCOUNTER_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      definition: structuredClone(selectedDefinition),
      combatant
    };
    downloadJson(`${safeFileName(selectedCombatant.displayName)}.${selectedCombatant.faction}.json`, payload);
  }

  function onSheetDragOver(event: DragEvent<HTMLElement>) {
    if (event.dataTransfer.types.includes("application/x-battle-sim-compendium")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDropActive(true);
    }
  }

  function onSheetDrop(event: DragEvent<HTMLElement>) {
    const raw = event.dataTransfer.getData("application/x-battle-sim-compendium");
    setDropActive(false);
    if (!raw) return;
    event.preventDefault();
    try {
      void compendium.attach(JSON.parse(raw) as CompendiumDragPayload);
    } catch {
      compendium.setStatus("Compendium drop failed");
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.top}>
        <button type="button" className={styles.create} onClick={onOpenCreate}>
          <UserPlus size={16} /> Create Token
        </button>
        <span className={styles.count}>{directory.length} actors · {encounter.combatants.length} tokens</span>
      </div>

      {selectedCombatant && selectedDefinition ? (
        <div className={styles.selection}>
          <div
            className={`${styles.summary} ${dropActive ? styles.dropActive : ""}`}
            onDragOver={onSheetDragOver}
            onDragLeave={() => setDropActive(false)}
            onDrop={onSheetDrop}
          >
            <ActorThumbnail definition={selectedDefinition} combatant={selectedCombatant} />
            <div>
              <strong>{selectedCombatant.displayName}</strong>
              <span>{selectedDefinition.name} · {selectedCombatant.faction}</span>
              <span>AC {selectedDefinition.armorClass} · HP {selectedCombatant.currentHp}/{selectedDefinition.maxHp} · {selectedCombatant.state}</span>
            </div>
          </div>
          <div className={styles.actions}>
            <button type="button" onClick={onOpenSheet}><Swords size={14} /> Sheet</button>
            <button type="button" onClick={duplicateSelected}><Copy size={14} /> Duplicate</button>
            <button type="button" onClick={exportSelected}><Download size={14} /> Export</button>
            <button type="button" onClick={() => void saveSelectedDefinition()}><Save size={14} /> Save</button>
            <button type="button" className={styles.danger} onClick={() => removeCombatant(selectedCombatant.id)}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
      ) : (
        <p className={styles.empty}>Select a token on the map, or create one.</p>
      )}

      <div className={styles.dirHead}>
        <span>Actor directory</span>
        <button type="button" onClick={() => void loadDefinitionsLibrary()} title="Refresh library">
          <FolderOpen size={14} />
        </button>
      </div>
      {compendium.status || definitionStatus ? (
        <p className={styles.status}>{definitionStatus || compendium.status}</p>
      ) : null}

      <ul className={styles.list}>
        {directory.length === 0 ? <li className={styles.empty}>No actors found.</li> : null}
        {directory.map((definition) => {
          const isSaved = savedDefinitionIds.has(definition.id);
          return (
            <li key={definition.id} draggable onDragStart={(event) => onActorDragStart(event, definition)}>
              <ActorThumbnail definition={definition} />
              <button type="button" className={styles.cardMain} onClick={() => addToEncounter(definition, defaultFactionForDefinition(definition))}>
                <strong>{definition.name}</strong>
                <span>{isSaved ? definition.source?.documentName ?? definition.source?.provider ?? "homebrew" : "scene actor"}</span>
              </button>
              <button type="button" onClick={() => addToEncounter(definition, "party")} title="Add as party"><Users size={14} /></button>
              <button type="button" onClick={() => addToEncounter(definition, "enemy")} title="Add as enemy"><Swords size={14} /></button>
              <button
                type="button"
                onClick={() => (isSaved ? void deleteLibraryDefinition(definition.id) : void saveDefinition(definition.id))}
                title={isSaved ? "Delete definition" : "Save to library"}
              >
                {isSaved ? <Trash2 size={14} /> : <Save size={14} />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
