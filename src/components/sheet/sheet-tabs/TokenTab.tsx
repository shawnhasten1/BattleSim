"use client";

import { useState } from "react";
import type { CombatantState, CreatureDefinition, Faction } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { readJson, writeJson } from "@/lib/persist";
import { Segmented } from "../ability-editor/controls";
import { SheetText } from "../SheetInputs";
import { TacticsSection } from "../token/TacticsSection";
import { AppearanceSection, FightSection, StatusSection } from "../token/TokenSections";
import styles from "../sheet.module.css";

/** Which of the Token tab's sections are open, per browser. This fight and Tactics start open (plan §3.4). */
const OPEN_KEY = "actor-sheet-token-open";
const OPEN_FIRST = ["fight", "tactics"];

const FACTIONS: Array<{ value: Faction; label: string }> = [
  { value: "party", label: "Party" }, { value: "enemy", label: "Enemy" }, { value: "neutral", label: "Neutral" }
];

/**
 * This token (plan §3.4): its name and side always in view, then folding sections for how it starts this fight, its
 * tactics, how it looks, and its state and square. Its HP and conditions are in the vitals strip above the tabs, and
 * what's left of its resources is in Abilities' resource list.
 */
export function TokenTab({ combatant, definition }: { combatant: CombatantState; definition: CreatureDefinition }) {
  const updateCombatant = useEncounterStore((s) => s.updateCombatant);
  const [open, setOpen] = useState<string[]>(() => readJson<string[]>(OPEN_KEY, OPEN_FIRST));
  const toggle = (id: string) => () => {
    const next = open.includes(id) ? open.filter((entry) => entry !== id) : [...open, id];
    setOpen(next);
    writeJson(OPEN_KEY, next);
  };

  return (
    <div className={styles.tab}>
      <div className={styles.core}>
        <div className={styles.coreRow}>
          <label className={`${styles.field} ${styles.grow}`}>
            Token name
            <SheetText value={combatant.displayName} onCommit={(displayName) => updateCombatant(combatant.id, { displayName })} />
          </label>
          <div className={styles.field}>
            Faction
            <Segmented label="Faction" value={combatant.faction} options={FACTIONS} onChange={(faction) => updateCombatant(combatant.id, { faction })} />
          </div>
        </div>
      </div>
      <FightSection combatant={combatant} definition={definition} open={open.includes("fight")} onToggle={toggle("fight")} />
      <TacticsSection combatant={combatant} open={open.includes("tactics")} onToggle={toggle("tactics")} />
      {/* Keyed by token: which image scope is picked is this token's, not the last one's. */}
      <AppearanceSection key={combatant.id} combatant={combatant} definition={definition} open={open.includes("appearance")} onToggle={toggle("appearance")} />
      <StatusSection combatant={combatant} open={open.includes("status")} onToggle={toggle("status")} />
    </div>
  );
}
