"use client";

import { ImagePlus } from "lucide-react";
import { type ChangeEvent } from "react";
import type { CombatantState, ConditionName, CreatureDefinition } from "@/engine";
import { MAX_ELEVATION_FT, useEncounterStore } from "@/store/encounter-store";
import { ActorThumbnail } from "@/components/ActorThumbnail";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { COMBATANT_STATE_HELP } from "@/lib/sheet-help";
import { SheetColor, SheetNumber, SheetText } from "../SheetInputs";
import styles from "../sheet.module.css";

const QUICK_CONDITIONS: ConditionName[] = ["poisoned", "prone", "restrained", "unconscious"];

export function TokenTab({ combatant, definition }: { combatant: CombatantState; definition: CreatureDefinition }) {
  const updateCombatant = useEncounterStore((s) => s.updateCombatant);
  const updateHp = useEncounterStore((s) => s.updateHp);
  const placeCombatant = useEncounterStore((s) => s.placeCombatant);
  const grid = useEncounterStore((s) => s.encounter.map.grid);
  const updateCombatantVisuals = useEncounterStore((s) => s.updateCombatantVisuals);
  const updateDefinitionVisuals = useEncounterStore((s) => s.updateDefinitionVisuals);
  const applyConditionToCombatant = useEncounterStore((s) => s.applyConditionToCombatant);
  const clearConditions = useEncounterStore((s) => s.clearConditions);
  const setAltitude = useEncounterStore((s) => s.setAltitude);
  const setInLair = useEncounterStore((s) => s.setInLair);
  const hasLair = (definition.lairActions?.length ?? 0) > 0;
  const groundHeight = useEncounterStore((s) => s.encounter.map.elevation?.cells[`${combatant.position.x},${combatant.position.y}`] ?? 0);
  const canFly = Boolean(definition.movement?.fly);

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
            <SheetText value={combatant.displayName} onCommit={(displayName) => updateCombatant(combatant.id, { displayName })} />
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
              <SheetNumber value={combatant.currentHp} min={0} max={definition.maxHp} onCommit={(hp) => updateHp(combatant.id, hp)} />
            </label>
            <label className={styles.field}>
              Temp HP
              <SheetNumber value={combatant.tempHp} min={0} max={999} onCommit={(tempHp) => updateCombatant(combatant.id, { tempHp })} />
            </label>
            {/* Placed as the Move tool places it: a large token's footprint stays on the grid. */}
            <label className={styles.field}>
              X
              <SheetNumber value={combatant.position.x} min={0} max={grid.width - 1} onCommit={(x) => placeCombatant(combatant.id, { ...combatant.position, x })} />
            </label>
            <label className={styles.field}>
              Y
              <SheetNumber value={combatant.position.y} min={0} max={grid.height - 1} onCommit={(y) => placeCombatant(combatant.id, { ...combatant.position, y })} />
            </label>
          </div>
          {hasLair ? (
            <label className={styles.field} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={Boolean(combatant.inLair)} onChange={(e) => setInLair([combatant.id], e.target.checked)} />
              <span>In its lair — takes a lair action on initiative 20 each round</span>
            </label>
          ) : null}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>
              Altitude
              <InfoTooltip
                label="About altitude"
                content="How many feet above the ground this token is flying. A creature more than its reach above a foe can't be hit in melee (bows and spells still reach), and it falls if it's knocked prone, can't move, or dies in the air — unless it can hover. The AI raises and lowers fliers itself; set it here to start a fight airborne."
              />
            </span>
            <div className={styles.chips}>
              <SheetNumber
                label="Altitude in feet" style={{ width: 72 }} value={combatant.altitude ?? 0} min={0} max={MAX_ELEVATION_FT} step={5}
                onCommit={(feet) => setAltitude([combatant.id], feet)}
              />
              <span style={{ alignSelf: "center", fontSize: 11 }}>ft up</span>
              {[0, 10, 20, 30, 60].map((feet) => (
                <button key={feet} type="button" aria-pressed={(combatant.altitude ?? 0) === feet} onClick={() => setAltitude([combatant.id], feet)}>
                  {feet === 0 ? "Land" : feet}
                </button>
              ))}
            </div>
            <p className={styles.note} style={{ margin: "4px 0 0" }}>
              {groundHeight !== 0 ? `Standing on ground ${groundHeight} ft high. ` : ""}
              {canFly
                ? `Flies ${definition.movement?.fly} ft${definition.movement?.hover ? " (hovers, so it stays up when knocked prone)" : ""}.`
                : (combatant.altitude ?? 0) > 0
                  ? "No fly speed — only magic (Fly, Levitate) keeps it up."
                  : "No fly speed."}
            </p>
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
            <SheetNumber value={visuals.scale ?? 1} min={0.5} max={1.5} step={0.05} onCommit={(scale) => updateCombatantVisuals(combatant.id, { scale })} />
          </label>
          <label className={styles.field}>
            Border
            <SheetColor value={visuals.borderColor ?? "#ffffff"} onCommit={(borderColor) => updateCombatantVisuals(combatant.id, { borderColor })} />
          </label>
          <label className={styles.field}>
            Tint
            <SheetColor value={visuals.tint ?? "#287277"} onCommit={(tint) => updateCombatantVisuals(combatant.id, { tint })} />
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
