"use client";

import type { CombatantState, CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import styles from "../sheet.module.css";

const PROFILES = ["basic-melee", "basic-ranged", "skirmisher", "brute", "defender", "controller"] as const;

export function TacticsTab({ combatant }: { combatant: CombatantState; definition: CreatureDefinition }) {
  const updateTactics = useEncounterStore((s) => s.updateTactics);

  return (
    <div className={styles.tab}>
      <section className={styles.section}>
        <h3>AI tactics</h3>
        <div className={styles.grid}>
          <label className={styles.field}>
            Profile
            <select
              value={combatant.tacticsProfile}
              onChange={(e) => updateTactics(combatant.id, e.target.value as typeof combatant.tacticsProfile)}
            >
              {PROFILES.map((profile) => (
                <option key={profile} value={profile}>{profile}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Faction
            <input value={combatant.faction} readOnly />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <h3>Simulation assumptions</h3>
        <p className={styles.note}>
          <span>Pathing respects walls, terrain, occupancy, and footprint size.</span>
          <span>The AI only considers actions with full automation support.</span>
          <span>Reference-only and unsupported content is skipped by batch runs.</span>
        </p>
      </section>
    </div>
  );
}
