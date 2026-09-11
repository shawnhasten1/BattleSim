"use client";

import { Dices, SkipForward, Swords, Waypoints } from "lucide-react";
import { useEffect, useRef } from "react";
import { getDefinition, type CombatantState } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { useSelectedCombatant } from "@/hooks/useSelectedCombatant";
import { useDisplayEncounter, useIsReplaying } from "@/hooks/useDisplayEncounter";
import { ReplayBar } from "@/components/combat/ReplayBar";
import { RESOURCE_STANCES } from "@/lib/resource-stances";
import styles from "./CombatPanel.module.css";

const TACTICS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "basic-melee", label: "Basic melee" },
  { value: "basic-ranged", label: "Basic ranged" },
  { value: "skirmisher", label: "Skirmisher" },
  { value: "brute", label: "Brute" },
  { value: "defender", label: "Defender" },
  { value: "controller", label: "Controller" }
];

function labelTactics(value: CombatantState["tacticsProfile"]): string {
  return TACTICS_OPTIONS.find((option) => option.value === value)?.label ?? "Basic melee";
}

function factionTacticsValue(
  combatants: CombatantState[],
  faction: CombatantState["faction"]
): CombatantState["tacticsProfile"] | "mixed" {
  const tactics = combatants.filter((c) => c.faction === faction).map((c) => c.tacticsProfile);
  const first = tactics[0];
  if (!first) return "basic-melee";
  return tactics.every((candidate) => candidate === first) ? first : "mixed";
}

function factionResourceStanceValue(
  combatants: CombatantState[],
  faction: CombatantState["faction"]
): CombatantState["resourceStance"] | "mixed" {
  const stances = combatants.filter((c) => c.faction === faction).map((c) => c.resourceStance);
  const first = stances[0];
  if (!first) return "balanced";
  return stances.every((candidate) => candidate === first) ? first : "mixed";
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function CombatPanel() {
  const encounter = useEncounterStore((state) => state.encounter);
  const displayEncounter = useDisplayEncounter();
  const replaying = useIsReplaying();
  const log = useEncounterStore((state) => state.log);
  const outcome = useEncounterStore((state) => state.outcome);
  const batchSummary = useEncounterStore((state) => state.batchSummary);
  const rollInitiativeNow = useEncounterStore((state) => state.rollInitiativeNow);
  const advanceTurn = useEncounterStore((state) => state.advanceTurn);
  const runAuto = useEncounterStore((state) => state.runAuto);
  const runBatch = useEncounterStore((state) => state.runBatch);
  const selectCombatant = useEncounterStore((state) => state.selectCombatant);
  const setArrivesRound = useEncounterStore((state) => state.setArrivesRound);
  const updateFactionTactics = useEncounterStore((state) => state.updateFactionTactics);
  const updateFactionResourceStance = useEncounterStore((state) => state.updateFactionResourceStance);
  const { selectedCombatant } = useSelectedCombatant();

  const logEndRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [log.length]);

  const currentCombatant = displayEncounter.round > 0
    ? displayEncounter.combatants[displayEncounter.turnIndex] ?? null
    : null;
  const currentDefinition = currentCombatant ? getDefinition(displayEncounter, currentCombatant) : null;
  const turnEvents = currentCombatant
    ? log.filter((entry) => entry.round === displayEncounter.round && entry.turnIndex === displayEncounter.turnIndex)
    : [];
  const latestTurnEvent = [...turnEvents]
    .reverse()
    .find(
      (entry) =>
        entry.type === "AiDecision" ||
        entry.type === "ActionDeclared" ||
        entry.type === "AttackRolled" ||
        entry.type === "SaveRolled" ||
        entry.type === "AutomationWarning"
    );
  const partyTactics = factionTacticsValue(encounter.combatants, "party");
  const enemyTactics = factionTacticsValue(encounter.combatants, "enemy");
  const partyResourceStance = factionResourceStanceValue(encounter.combatants, "party");
  const enemyResourceStance = factionResourceStanceValue(encounter.combatants, "enemy");

  const headerStatus = replaying
    ? `Replay · round ${displayEncounter.round}`
    : encounter.round > 0
      ? `Round ${encounter.round}`
      : outcome
        ? `${outcome.winner ?? "No faction"} wins`
        : "Ready";

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <strong>Initiative Order</strong>
        <span>{headerStatus}</span>
      </header>

      <div className={styles.turnStatus}>
        <div><span>Current</span><strong>{currentCombatant?.displayName ?? "Not started"}</strong></div>
        <div><span>Tactic</span><strong>{currentCombatant ? labelTactics(currentCombatant.tacticsProfile) : "-"}</strong></div>
        <div><span>HP</span><strong>{currentCombatant && currentDefinition ? `${currentCombatant.currentHp}/${currentDefinition.maxHp}` : "-"}</strong></div>
        <div className={styles.latest}><span>Latest</span><strong>{latestTurnEvent?.message ?? "Step to begin"}</strong></div>
      </div>

      <div className={styles.controls}>
        <button type="button" onClick={rollInitiativeNow}><Dices size={15} /> Initiative</button>
        <button type="button" onClick={advanceTurn}><SkipForward size={15} /> Step</button>
        <button type="button" data-primary onClick={() => void runAuto()}><Swords size={15} /> Auto Run</button>
        <button type="button" onClick={() => runBatch(100)}><Waypoints size={15} /> Batch 100</button>
      </div>

      <ReplayBar />

      <div className={styles.tactics}>
        <label>
          <span>Party tactics</span>
          <select
            value={partyTactics}
            onChange={(event) => updateFactionTactics("party", event.target.value as CombatantState["tacticsProfile"])}
          >
            <option value="mixed" disabled>Mixed</option>
            {TACTICS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Enemy tactics</span>
          <select
            value={enemyTactics}
            onChange={(event) => updateFactionTactics("enemy", event.target.value as CombatantState["tacticsProfile"])}
          >
            <option value="mixed" disabled>Mixed</option>
            {TACTICS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Party resources</span>
          <select
            value={partyResourceStance}
            onChange={(event) => updateFactionResourceStance("party", event.target.value as CombatantState["resourceStance"])}
          >
            <option value="mixed" disabled>Mixed</option>
            {RESOURCE_STANCES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Enemy resources</span>
          <select
            value={enemyResourceStance}
            onChange={(event) => updateFactionResourceStance("enemy", event.target.value as CombatantState["resourceStance"])}
          >
            <option value="mixed" disabled>Mixed</option>
            {RESOURCE_STANCES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <ul className={styles.initiative}>
        {displayEncounter.combatants.map((combatant) => {
          const definition = getDefinition(displayEncounter, combatant);
          const reserve = combatant.state === "reserve";
          const preCombat = displayEncounter.round <= 0 && !replaying;
          const arrivesRound = combatant.arrivesRound ?? 1;
          return (
            <li key={combatant.id}>
              <button
                type="button"
                className={[
                  combatant.id === selectedCombatant?.id ? styles.selected : "",
                  combatant.id === currentCombatant?.id ? styles.active : "",
                  reserve ? styles.reserve : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => selectCombatant(combatant.id)}
              >
                <span className={styles.init}>{combatant.initiative ?? "-"}</span>
                <span className={styles.name}>{combatant.displayName}</span>
                <span className={styles.hp}>
                  {reserve ? `arrives R${combatant.arrivesRound ?? "?"}` : `${combatant.currentHp}/${definition.maxHp}`}
                </span>
              </button>
              {preCombat ? (
                <div className={styles.arrival} title="Round this token enters play">
                  <button
                    type="button"
                    aria-label={`${combatant.displayName}: arrive one round earlier`}
                    disabled={!combatant.arrivesRound}
                    onClick={() => setArrivesRound([combatant.id], arrivesRound - 1)}
                  >
                    −
                  </button>
                  <span>{combatant.arrivesRound ? `R${combatant.arrivesRound}` : "on board"}</span>
                  <button
                    type="button"
                    aria-label={`${combatant.displayName}: arrive one round later`}
                    onClick={() => setArrivesRound([combatant.id], arrivesRound + 1)}
                  >
                    +
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <details className={styles.section} open={Boolean(batchSummary)}>
        <summary>Batch report{batchSummary ? ` · avg ${batchSummary.rounds.average} rounds` : ""}</summary>
        {batchSummary ? (
          <>
            <div className={styles.reportGrid}>
              <div><span>Party win</span><strong>{percent(batchSummary.partyWinRate)}</strong></div>
              <div><span>Enemy win</span><strong>{percent(batchSummary.enemyWinRate)}</strong></div>
              <div><span>TPK</span><strong>{percent(batchSummary.tpkRate)}</strong></div>
              <div><span>Avg rounds</span><strong>{batchSummary.rounds.average}</strong></div>
              <div><span>Difficulty</span><strong>{batchSummary.difficultyLabel}</strong></div>
              <div><span>Deaths</span><strong>{percent(batchSummary.characterDeathRate)}</strong></div>
              <div><span>P90 rounds</span><strong>{batchSummary.rounds.p90}</strong></div>
              <div><span>HP left</span><strong>{batchSummary.remainingHpByFaction.party ?? 0}</strong></div>
            </div>

            {batchSummary.roundDistribution.length ? (
              <div className={styles.histogram} aria-label="Round-count distribution">
                {(() => {
                  const peak = Math.max(...batchSummary.roundDistribution.map((bin) => bin.count));
                  return batchSummary.roundDistribution.map((bin) => (
                    <div key={bin.round} className={styles.histBar} title={`${bin.count} run(s) ended on round ${bin.round}`}>
                      <span className={styles.histFill} style={{ height: `${Math.round((bin.count / peak) * 100)}%` }} />
                      <small>{bin.round}</small>
                    </div>
                  ));
                })()}
              </div>
            ) : null}

            {batchSummary.warnings.length ? (
              <ul className={styles.warnings}>
                {batchSummary.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}

            <div className={styles.metrics}>
              {batchSummary.damageByCombatant.map((metric) => (
                <div key={metric.combatantId}>
                  <span>{metric.displayName}</span>
                  <strong>{metric.damageDealt} dealt</strong>
                  <strong>{metric.damageTaken} taken</strong>
                  <strong>{metric.resourceSpent > 0 ? `${metric.resourceSpent} res` : `${metric.endingHp} HP`}</strong>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className={styles.empty}>Run a batch simulation to populate tuning metrics.</p>
        )}
      </details>

      {!replaying && log.length ? (
        <details className={styles.section}>
          <summary>Combat log{outcome ? ` · ${outcome.winner ?? "no winner"} after ${outcome.rounds}` : ""}</summary>
          <ol className={styles.logList}>
            {log.map((entry) => (
              <li key={entry.id}>
                <span>{entry.message}</span>
                <small>{entry.type}</small>
                {entry.data ? (
                  <details>
                    <summary>details</summary>
                    <pre>{JSON.stringify(entry.data, null, 2)}</pre>
                  </details>
                ) : null}
              </li>
            ))}
            <li ref={logEndRef} aria-hidden="true" />
          </ol>
        </details>
      ) : null}
    </div>
  );
}
