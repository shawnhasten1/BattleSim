"use client";

import { ImagePlus } from "lucide-react";
import { type ChangeEvent } from "react";
import type { CombatantState, ConditionName, CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { ActorThumbnail } from "@/components/ActorThumbnail";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { COMBATANT_STATE_HELP } from "@/lib/sheet-help";
import styles from "../sheet.module.css";

const QUICK_CONDITIONS: ConditionName[] = ["poisoned", "prone", "restrained", "unconscious"];

export function TokenTab({ combatant, definition }: { combatant: CombatantState; definition: CreatureDefinition }) {
  const updateCombatant = useEncounterStore((s) => s.updateCombatant);
  const updateHp = useEncounterStore((s) => s.updateHp);
  const updateCombatantVisuals = useEncounterStore((s) => s.updateCombatantVisuals);
  const updateDefinitionVisuals = useEncounterStore((s) => s.updateDefinitionVisuals);
  const applyConditionToCombatant = useEncounterStore((s) => s.applyConditionToCombatant);
  const clearConditions = useEncounterStore((s) => s.clearConditions);

  const visuals = { ...(definition.tokenVisuals ?? {}), ...(combatant.tokenVisuals ?? {}) };

  function onImageUpload(event: ChangeEvent<HTMLInputElement>, scope: "token" | "definition") {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = typeof reader.result === "string" ? reader.result : undefined;
      if (!imageUrl) return;
      if (scope === "token") updateCombatantVisuals(combatant.id, { imageUrl });
      else updateDefinitionVisuals(definition.id, { imageUrl });
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  return (
    <div className={styles.tab}>
      <section className={styles.section}>
        <h3>Token instance</h3>
        <div className={styles.stack}>
          <label className={styles.field}>
            Name
            <input value={combatant.displayName} onChange={(e) => updateCombatant(combatant.id, { displayName: e.target.value })} />
          </label>
          <div className={styles.grid}>
            <label className={styles.field}>
              Faction
              <select value={combatant.faction} onChange={(e) => updateCombatant(combatant.id, { faction: e.target.value as typeof combatant.faction })}>
                <option value="party">Party</option>
                <option value="enemy">Enemy</option>
                <option value="neutral">Neutral</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                State
                <InfoTooltip label="About combatant states" content={COMBATANT_STATE_HELP} />
              </span>
              <select value={combatant.state} onChange={(e) => updateCombatant(combatant.id, { state: e.target.value as typeof combatant.state })}>
                <option value="active">Active</option>
                <option value="downed">Downed</option>
                <option value="defeated">Defeated</option>
                <option value="dead">Dead</option>
                <option value="fled">Fled</option>
              </select>
            </label>
            <label className={styles.field}>
              Current HP
              <input type="number" value={combatant.currentHp} onChange={(e) => updateHp(combatant.id, Number(e.target.value))} />
            </label>
            <label className={styles.field}>
              Temp HP
              <input type="number" value={combatant.tempHp} onChange={(e) => updateCombatant(combatant.id, { tempHp: Number(e.target.value) })} />
            </label>
            <label className={styles.field}>
              X
              <input type="number" value={combatant.position.x} onChange={(e) => updateCombatant(combatant.id, { position: { ...combatant.position, x: Number(e.target.value) } })} />
            </label>
            <label className={styles.field}>
              Y
              <input type="number" value={combatant.position.y} onChange={(e) => updateCombatant(combatant.id, { position: { ...combatant.position, y: Number(e.target.value) } })} />
            </label>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h3>Token visual</h3>
        <div className={styles.tokenArt}>
          <ActorThumbnail definition={definition} combatant={combatant} />
          <div style={{ flex: 1 }}>
            <div className={styles.uploadRow}>
              <label className={styles.upload}>
                <ImagePlus size={13} /> Token
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onImageUpload(e, "token")} />
              </label>
              <label className={styles.upload}>
                <ImagePlus size={13} /> Actor default
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onImageUpload(e, "definition")} />
              </label>
            </div>
            <div className={styles.uploadRow}>
              <button type="button" className={styles.upload} onClick={() => updateCombatantVisuals(combatant.id, { imageUrl: undefined })}>Clear token</button>
              <button type="button" className={styles.upload} onClick={() => updateDefinitionVisuals(definition.id, { imageUrl: undefined })}>Clear default</button>
            </div>
          </div>
        </div>
        <div className={styles.grid} style={{ marginTop: 6 }}>
          <label className={styles.field}>
            Scale
            <input type="number" min={0.5} max={1.5} step={0.05} value={visuals.scale ?? 1} onChange={(e) => updateCombatantVisuals(combatant.id, { scale: Number(e.target.value) })} />
          </label>
          <label className={styles.field}>
            Border
            <input type="color" value={visuals.borderColor ?? "#ffffff"} onChange={(e) => updateCombatantVisuals(combatant.id, { borderColor: e.target.value })} />
          </label>
          <label className={styles.field}>
            Tint
            <input type="color" value={visuals.tint ?? "#287277"} onChange={(e) => updateCombatantVisuals(combatant.id, { tint: e.target.value })} />
          </label>
        </div>
        <label className={`${styles.field} ${styles.checkLine}`} style={{ marginTop: 8 }}>
          <input type="checkbox" checked={visuals.showNameplate ?? false} onChange={(e) => updateCombatantVisuals(combatant.id, { showNameplate: e.target.checked })} />
          Show nameplate
        </label>
      </section>

      <section className={styles.section}>
        <h3>Conditions</h3>
        <div className={styles.chips}>
          {QUICK_CONDITIONS.map((condition) => (
            <button key={condition} type="button" onClick={() => applyConditionToCombatant(combatant.id, condition)}>
              {condition}
            </button>
          ))}
          <button type="button" onClick={() => clearConditions(combatant.id)}>clear</button>
        </div>
        <div className={styles.active_conditions}>
          {(combatant.conditions ?? []).map((condition) => (
            <span key={condition.id}>{condition.name}</span>
          ))}
        </div>
      </section>
    </div>
  );
}
