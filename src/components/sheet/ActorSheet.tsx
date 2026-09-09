"use client";

import { useState, type DragEvent } from "react";
import { useSelectedCombatant } from "@/hooks/useSelectedCombatant";
import type { Compendium } from "@/hooks/useCompendium";
import type { CompendiumDragPayload } from "@/lib/compendium";
import { buildSheetItems } from "@/lib/sheet";
import { sourceLabel } from "@/lib/ui-helpers";
import { AutomationBadge } from "@/components/ui/AutomationBadge";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import { StatsTab } from "./sheet-tabs/StatsTab";
import { ActionsTab } from "./sheet-tabs/ActionsTab";
import { LoadoutTab } from "./sheet-tabs/LoadoutTab";
import { FeaturesTab } from "./sheet-tabs/FeaturesTab";
import { TacticsTab } from "./sheet-tabs/TacticsTab";
import { TokenTab } from "./sheet-tabs/TokenTab";
import styles from "./sheet.module.css";

const TABS = [
  { id: "stats", label: "Stats" },
  { id: "actions", label: "Actions" },
  { id: "loadout", label: "Loadout" },
  { id: "features", label: "Features" },
  { id: "tactics", label: "Tactics" },
  { id: "token", label: "Token" }
] as const;
type SheetTabId = (typeof TABS)[number]["id"];

/**
 * Floating, draggable actor/token sheet for the selected combatant. Replaces
 * the old full-screen edit modal. Compendium items dragged anywhere onto the
 * window attach to this actor.
 */
export function ActorSheet({ compendium, onClose }: { compendium: Compendium; onClose: () => void }) {
  const { selectedCombatant, selectedDefinition } = useSelectedCombatant();
  const [tab, setTab] = useState<SheetTabId>("token");
  const [dropActive, setDropActive] = useState(false);

  if (!selectedCombatant || !selectedDefinition) return null;
  const combatant = selectedCombatant;
  const definition = selectedDefinition;
  const items = buildSheetItems(definition);

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (event.dataTransfer.types.includes("application/x-battle-sim-compendium")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDropActive(true);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    const raw = event.dataTransfer.getData("application/x-battle-sim-compendium");
    setDropActive(false);
    if (!raw) return;
    event.preventDefault();
    try {
      void compendium.attach(JSON.parse(raw) as CompendiumDragPayload, definition.id, combatant.id);
    } catch {
      compendium.setStatus("Compendium drop failed");
    }
  }

  return (
    <FloatingWindow
      title={
        <>
          {definition.name} <span>· {combatant.displayName}</span>
        </>
      }
      ariaLabel={`${definition.name} sheet`}
      storageKey="actor-sheet"
      onClose={onClose}
      headerExtra={<AutomationBadge value={items.worst} />}
      dropActive={dropActive}
      onDragOver={onDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <div className={styles.tabs} role="tablist" aria-label="Actor sheet sections">
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
      {compendium.status ? <p className={styles.status}>{compendium.status}</p> : null}
      <p className={styles.status} style={{ borderBottom: "1px solid var(--ui-border)" }}>
        {combatant.faction} · {sourceLabel(definition.source)}
      </p>

      {tab === "stats" ? <StatsTab combatant={combatant} definition={definition} /> : null}
      {tab === "actions" ? <ActionsTab combatant={combatant} definition={definition} /> : null}
      {tab === "loadout" ? <LoadoutTab combatant={combatant} definition={definition} compendium={compendium} /> : null}
      {tab === "features" ? <FeaturesTab combatant={combatant} definition={definition} /> : null}
      {tab === "tactics" ? <TacticsTab combatant={combatant} definition={definition} /> : null}
      {tab === "token" ? <TokenTab combatant={combatant} definition={definition} /> : null}
    </FloatingWindow>
  );
}
