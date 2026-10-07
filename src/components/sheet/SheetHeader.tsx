"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { actualMaxHp, armorClassOf, effectiveDefinition, type CombatantState, type ConditionInstance, type CreatureDefinition, type EncounterSnapshot, type Faction } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { useLibrarySyncStore } from "@/store/library-sync-store";
import { automationSummary } from "@/lib/actor-sheet/ai-uses";
import { concentrationOf, conditionLabel, describeCondition, DM_CONDITIONS, statusOf } from "@/lib/actor-sheet/conditions";
import { speedLine } from "@/lib/actor-sheet/summaries";
import { ActorThumbnail } from "@/components/ActorThumbnail";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { HpBar } from "@/components/ui/HpBar";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { SheetNumber } from "./SheetInputs";
import { useSheetMode } from "./sheet-mode";
import abilityStyles from "./abilities/abilities.module.css";
import styles from "./sheet.module.css";

const FACTIONS: Record<Faction, string> = { party: "Party", enemy: "Enemy", neutral: "Neutral" };

/**
 * The token's vitals, above the tabs so they're in view on every one (plan D2): HP and temp HP to edit, AC, speed and
 * faction, then its status, conditions and concentration, and + Condition. When its creature has several tokens, a
 * switcher picks which one's vitals these are (CHARACTER_SHEET_WINDOWS_PLAN.md D2).
 */
export function VitalsStrip({ combatant, definition, tokens = [], onShowToken }: {
  combatant: CombatantState;
  definition: CreatureDefinition;
  /** Every token of its creature; the switcher shows when there's more than one. */
  tokens?: CombatantState[];
  onShowToken?: (combatantId: string) => void;
}) {
  const updateHp = useEncounterStore((s) => s.updateHp);
  const updateCombatant = useEncounterStore((s) => s.updateCombatant);
  const { tokenless } = useSheetMode();

  if (tokenless) {
    // No token: what every new one starts with, and nothing that belongs to one (hit points taken, conditions).
    const facts = `HP ${actualMaxHp(definition)} · AC ${armorClassOf(definition).total} · ${speedLine(definition)}`;
    return (
      <div className={styles.vitals} role="group" aria-label="Vitals">
        <ActorThumbnail definition={definition} />
        <div className={styles.vitalsBody}>
          <div className={styles.vitalsRow}>
            <span className={styles.vitalsFacts} title={facts}>{facts}</span>
          </div>
          <div className={styles.vitalsRow}>
            <span className={styles.vitalsDim}>No token in this scene: drag {definition.name} onto the map from the Actors tab to place one.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.vitals} role="group" aria-label="Vitals">
      <ActorThumbnail definition={definition} combatant={combatant} />
      <div className={styles.vitalsBody}>
        {tokens.length > 1 && onShowToken ? (
          <div className={styles.vitalsRow}>
            <span className={styles.vitalsLabel}>Token</span>
            <select
              className={styles.tokenSwitch} aria-label="Token shown" value={combatant.id}
              onChange={(event) => onShowToken(event.target.value)}
            >
              {tokens.map((token) => (
                <option key={token.id} value={token.id}>{token.displayName} · {token.currentHp}/{actualMaxHp(definition, token)} HP</option>
              ))}
            </select>
            <span className={styles.vitalsDim}>{tokens.findIndex((token) => token.id === combatant.id) + 1} of {tokens.length}</span>
          </div>
        ) : null}
        <div className={styles.vitalsRow}>
          <span className={styles.vitalsLabel}>HP</span>
          <SheetNumber label="Hit points" className={styles.vitalsBox} value={combatant.currentHp} min={0} max={actualMaxHp(definition, combatant)} onCommit={(hp) => updateHp(combatant.id, hp)} />
          <span className={styles.vitalsDim}>/ {actualMaxHp(definition, combatant)}</span>
          <HpBar current={combatant.currentHp} max={actualMaxHp(definition, combatant)} width={96} />
          <span className={styles.vitalsLabel}>Temp</span>
          <SheetNumber label="Temporary hit points" className={styles.vitalsBox} value={combatant.tempHp} min={0} max={999} onCommit={(tempHp) => updateCombatant(combatant.id, { tempHp })} />
          <span className={styles.vitalsFacts} title={`AC ${armorClassOf(definition, combatant).total} · speed ${speedLine(effectiveDefinition(definition, combatant))} · ${FACTIONS[combatant.faction]}`}>
            AC {armorClassOf(definition, combatant).total} · {speedLine(effectiveDefinition(definition, combatant))} · <span className={styles.faction} data-faction={combatant.faction}>{FACTIONS[combatant.faction]}</span>
          </span>
        </div>
        <ConditionsRow combatant={combatant} definition={definition} className={styles.vitalsRow} />
      </div>
    </div>
  );
}

/**
 * A token's status, its conditions (each with what it does, and × to take it off), what it concentrates on, and
 * + Condition: the vitals strip's second row, and the Codex's (CHARACTER_SHEET_WINDOWS_PLAN.md Part 3).
 */
export function ConditionsRow({ combatant, definition, className }: { combatant: CombatantState; definition: CreatureDefinition; className?: string }) {
  const encounter = useEncounterStore((s) => s.encounter);
  const applyConditionToCombatant = useEncounterStore((s) => s.applyConditionToCombatant);
  const removeCondition = useEncounterStore((s) => s.removeCondition);
  const mergeEdits = useEncounterStore((s) => s.mergeEdits);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);

  const conditions = combatant.conditions ?? [];
  const status = statusOf(combatant);
  const concentrating = concentrationOf(combatant, encounter);
  const immune = new Set<string>(definition.conditionImmunities ?? []);

  const pickerItems: ContextMenuItem[] = [
    { heading: "Add a condition" },
    ...DM_CONDITIONS.map((name): ContextMenuItem => {
      const has = conditions.some((condition) => condition.name === name);
      return {
        label: `${name.charAt(0).toUpperCase()}${name.slice(1)}${immune.has(name) ? " (immune)" : ""}`,
        checked: has,
        // Already on it: take it off with its chip's ×, which says which one when there are two.
        disabled: has,
        keepOpen: true,
        onSelect: () => applyConditionToCombatant(combatant.id, name)
      };
    }),
    ...(conditions.length > 1
      ? [
          { separator: true } as ContextMenuItem,
          {
            label: "Remove them all",
            danger: true,
            // One undo step; its own concentration, if any, is untouched.
            onSelect: () => mergeEdits(`remove-all:${combatant.id}:${Date.now()}`, () => conditions.forEach((condition) => removeCondition(combatant.id, condition.id)))
          } as ContextMenuItem
        ]
      : [])
  ];

  return (
    <div className={className}>
      {status ? <span className={styles.statusChip}>{status}</span> : null}
      {conditions.map((condition) => (
        <ConditionChip key={condition.id} condition={condition} combatant={combatant} encounter={encounter} onRemove={() => removeCondition(combatant.id, condition.id)} />
      ))}
      {concentrating ? <span className={styles.statusChip}>Concentrating on {concentrating}</span> : null}
      <button
        type="button" className={styles.addCondition} aria-haspopup="menu" aria-expanded={picker !== null}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPicker(picker ? null : { x: rect.left, y: rect.bottom + 4 });
        }}
      >
        + Condition
      </button>
      {picker ? <ContextMenu x={picker.x} y={picker.y} items={pickerItems} onClose={() => setPicker(null)} /> : null}
    </div>
  );
}


/** One condition: its name shows what it does, where it came from and what ends it; × takes it off. */
function ConditionChip({ condition, combatant, encounter, onRemove }: {
  condition: ConditionInstance;
  combatant: CombatantState;
  encounter: EncounterSnapshot;
  onRemove: () => void;
}) {
  const label = conditionLabel(condition);
  const description = describeCondition(condition, combatant, encounter);
  return (
    <span className={styles.conditionChip}>
      <InfoTooltip
        label={label} className={styles.conditionName}
        content={(
          <>
            <p><strong>{label}</strong>: {description.effects.join("; ")}.</p>
            {description.source ? <p>{description.source}.</p> : null}
            {description.ends.map((line) => <p key={line}>{line}.</p>)}
          </>
        )}
      >
        {label}
      </InfoTooltip>
      <button type="button" className={styles.conditionRemove} aria-label={`Remove ${label}`} onClick={onRemove}>
        <X size={11} />
      </button>
    </span>
  );
}

/**
 * Where the last change to a library actor you own stands (ACTORS_TAB_PLAN.md, Phase 1): saving to the library, saved
 * there, or failed with Retry. Nothing for an actor that isn't linked, or before its first change.
 */
export function LibrarySaveStatus({ definition }: { definition: Pick<CreatureDefinition, "id" | "name"> }) {
  const state = useLibrarySyncStore((s) => s.states[definition.id]);
  const retry = useLibrarySyncStore((s) => s.retry);
  if (!state) return null;
  if (state === "failed") {
    return (
      <span className={styles.librarySave} data-state="failed" role="status">
        Not saved
        <button type="button" onClick={() => retry(definition.id)} title={`Save ${definition.name} to your library again`}>Retry</button>
      </span>
    );
  }
  const saved = state === "saved";
  return (
    <span
      className={styles.librarySave}
      data-state={state}
      role="status"
      title={saved ? `Changes to ${definition.name} are saved to your library.` : `Saving ${definition.name} to your library…`}
    >
      {saved ? "Saved" : "Saving…"}
    </span>
  );
}

/**
 * How much of the creature the simulator runs, counted from the Abilities list's dots (it replaces the old badge, so
 * there's one vocabulary). Clicking it opens the Abilities tab.
 */
export function AutomationCount({ definition, combatant, onOpen }: { definition: CreatureDefinition; combatant: CombatantState; onOpen: () => void }) {
  const summary = automationSummary(definition, combatant);
  if (!summary.total) return null;
  const detail = [
    `${summary.simulated} of ${summary.total} abilities are simulated as written.`,
    summary.partly.length ? `Partly: ${summary.partly.join(", ")}.` : "",
    summary.reference.length ? `Reference only, never used by the AI: ${summary.reference.join(", ")}.` : ""
  ].filter(Boolean).join(" ");
  return (
    <button type="button" className={styles.automationCount} title={detail} aria-label={`${detail} Show them on the Abilities tab.`} onClick={onOpen}>
      <span className={abilityStyles.dot} data-automation={summary.worst} aria-hidden="true" />
      {summary.simulated}/{summary.total}
    </button>
  );
}
