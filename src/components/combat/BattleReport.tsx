"use client";

import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { buildBattleReport, type ActorReport, type EncounterSnapshot } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import { HpBar } from "@/components/ui/HpBar";
import { Thumb } from "@/components/ui/Thumb";
import styles from "./BattleReport.module.css";

const FACTION_ORDER = ["party", "enemy", "neutral"] as const;
const FACTION_LABEL: Record<string, string> = { party: "Party", enemy: "Enemies", neutral: "Neutral" };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function stateBadge(actor: ActorReport): { label: string; tone: "down" | "dead" } | null {
  if (actor.died || actor.finalState === "dead") return { label: "DEAD", tone: "dead" };
  if (actor.finalState === "downed" || actor.finalState === "defeated") {
    return { label: actor.faction === "party" ? "DOWN" : "OUT", tone: "down" };
  }
  return null;
}

export function BattleReport({ onClose }: { onClose: () => void }) {
  const encounter = useEncounterStore((state) => state.encounter);
  const log = useEncounterStore((state) => state.log);
  const report = useMemo(() => buildBattleReport(encounter, log), [encounter, log]);
  const [copied, setCopied] = useState(false);

  const groups = FACTION_ORDER.map((faction) => ({
    faction,
    actors: report.actors.filter((actor) => actor.faction === faction)
  })).filter((group) => group.actors.length > 0);

  async function copyAsText() {
    try {
      await navigator.clipboard.writeText(reportToText(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <FloatingWindow
      title="Battle Report"
      ariaLabel="Battle report"
      storageKey="battle-report"
      width={480}
      initialPosition={{ x: 96, y: 72 }}
      onClose={onClose}
      headerExtra={
        <button type="button" className={styles.copyBtn} onClick={copyAsText} title="Copy as text">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      }
    >
      <div className={styles.summary}>
        <div><span>Outcome</span><strong>{report.winner ? `${FACTION_LABEL[report.winner] ?? report.winner} win` : "Draw"}</strong></div>
        <div><span>Rounds</span><strong>{report.rounds}</strong></div>
        <div><span>Party dmg</span><strong>{report.factionTotals.party?.damageDealt ?? 0}</strong></div>
        <div><span>Enemy dmg</span><strong>{report.factionTotals.enemy?.damageDealt ?? 0}</strong></div>
        <div><span>Healing</span><strong>{report.factionTotals.party?.healingGiven ?? 0}</strong></div>
        <div><span>Downs</span><strong>{report.factionTotals.party?.downs ?? 0}</strong></div>
        <div><span>Deaths</span><strong>{report.factionTotals.party?.deaths ?? 0}</strong></div>
        <div><span>Party HP left</span><strong>{report.factionTotals.party?.hpRemaining ?? 0}</strong></div>
      </div>

      {report.warnings.length ? (
        <ul className={styles.warnings}>
          {report.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {groups.map((group) => (
        <section key={group.faction} className={styles.group}>
          <h4>{FACTION_LABEL[group.faction] ?? group.faction}</h4>
          {group.actors.map((actor) => (
            <ActorEntry key={actor.combatantId} actor={actor} portrait={portraitFor(encounter, actor.combatantId)} />
          ))}
        </section>
      ))}
    </FloatingWindow>
  );
}

function portraitFor(encounter: EncounterSnapshot, id: string): string | undefined {
  const combatant = encounter.combatants.find((c) => c.id === id);
  return combatant?.tokenVisuals?.portraitUrl ?? combatant?.tokenVisuals?.imageUrl;
}

function ActorEntry({ actor, portrait }: { actor: ActorReport; portrait?: string }) {
  const badge = stateBadge(actor);
  return (
    <details className={styles.actor} data-faction={actor.faction}>
      <summary>
        <Thumb imageUrl={portrait} fallback={initials(actor.displayName)} size={26} />
        <span className={styles.name}>{actor.displayName}</span>
        <HpBar current={actor.endingHp} max={actor.maxHp} width={54} />
        <span className={styles.headline} title="Damage dealt">{actor.damageDealt} <i>dmg</i></span>
        {actor.killingBlows > 0 ? <span className={styles.koBadge}>{actor.killingBlows} KO</span> : null}
        {badge ? <span className={styles.statePill} data-tone={badge.tone}>{badge.label}</span> : null}
      </summary>

      <div className={styles.stats}>
        <div><span>Damage dealt</span><strong>{actor.damageDealt}</strong></div>
        <div><span>Damage taken</span><strong>{actor.damageTaken}</strong></div>
        <div><span>Hit / miss</span><strong>{actor.attacksHit}<i> / </i>{actor.attacksMissed}</strong></div>
        <div><span>Crits</span><strong>{actor.criticalHits}</strong></div>
        <div><span>Final hits</span><strong>{actor.killingBlows}</strong></div>
        <div><span>Saves made / failed</span><strong>{actor.savesMade}<i> / </i>{actor.savesFailed}</strong></div>
        <div><span>Saves forced (failed)</span><strong>{actor.savesForced}<i> (</i>{actor.savesForcedFailed}<i>)</i></strong></div>
        <div><span>Healing given / recvd</span><strong>{actor.healingGiven}<i> / </i>{actor.healingReceived}</strong></div>
        <div><span>OA / reactions</span><strong>{actor.opportunityAttacks}<i> / </i>{actor.reactionsUsed}</strong></div>
        <div><span>Times downed</span><strong>{actor.timesDowned}</strong></div>
      </div>

      {actor.resourcesSpent.length ? (
        <div className={styles.chips}>
          <span className={styles.chipsLabel}>Resources</span>
          {actor.resourcesSpent.map((resource) => (
            <span key={resource.resourceId} className={styles.chip}>
              {resource.amount}× {resource.label}
            </span>
          ))}
        </div>
      ) : null}

      {actor.conditionsSuffered.length ? (
        <div className={styles.chips}>
          <span className={styles.chipsLabel}>Suffered</span>
          {actor.conditionsSuffered.map((condition) => (
            <span key={condition} className={styles.chip}>{condition}</span>
          ))}
        </div>
      ) : null}
    </details>
  );
}

function reportToText(report: ReturnType<typeof buildBattleReport>): string {
  const header = [
    `Battle Report — ${report.winner ? `${FACTION_LABEL[report.winner] ?? report.winner} win` : "Draw"} after ${report.rounds} rounds`,
    ""
  ];
  const cols: Array<[string, (a: ActorReport) => string]> = [
    ["Actor", (a) => a.displayName],
    ["Dealt", (a) => String(a.damageDealt)],
    ["Taken", (a) => String(a.damageTaken)],
    ["Hit", (a) => String(a.attacksHit)],
    ["Miss", (a) => String(a.attacksMissed)],
    ["Crit", (a) => String(a.criticalHits)],
    ["KO", (a) => String(a.killingBlows)],
    ["Heal", (a) => String(a.healingGiven)],
    ["Res", (a) => String(a.totalResourcePoints)]
  ];
  const rows = report.actors.map((actor) => cols.map(([, get]) => get(actor)));
  const widths = cols.map(([label], index) =>
    Math.max(label.length, ...rows.map((row) => row[index].length))
  );
  const line = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();
  return [
    ...header,
    line(cols.map(([label]) => label)),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map(line)
  ].join("\n");
}
