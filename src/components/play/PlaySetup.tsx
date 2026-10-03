"use client";

import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { Controller, Faction, PlayControl } from "@/engine";
import { readJson, writeJson } from "@/lib/persist";
import { useEncounterStore } from "@/store/encounter-store";
import type { PlaybackSpeed } from "@/store/play-slice";
import { Toggle } from "@/components/ui/Toggle";
import { PlaySegmented, SPEED_OPTIONS } from "./PlaySegmented";
import styles from "./play.module.css";

const FACTIONS: Array<{ faction: Faction; label: string }> = [
  { faction: "party", label: "Party" },
  { faction: "enemy", label: "Enemies" },
  { faction: "neutral", label: "Neutral" }
];

interface PlayPrefs {
  factions: Partial<Record<Faction, Controller>>;
  askReactions: boolean;
  askOpportunityAttacks: boolean;
  playbackSpeed: PlaybackSpeed;
}

const DEFAULT_PREFS: PlayPrefs = { factions: { party: "human", enemy: "ai", neutral: "ai" }, askReactions: true, askOpportunityAttacks: true, playbackSpeed: 1 };
const PREFS_KEY = "playSetup";

/**
 * Starting a fight in Play, from the Combat panel: who plays each side in the scene, whether to be asked before your
 * creatures react, and how the AI's turns play out. Remembered in this browser for next time.
 */
export function PlaySetup({ onCancel }: { onCancel: () => void }) {
  const combatants = useEncounterStore((state) => state.encounter.combatants);
  const startPlay = useEncounterStore((state) => state.startPlay);
  const [prefs, setPrefs] = useState<PlayPrefs>(DEFAULT_PREFS);
  useEffect(() => {
    setPrefs({ ...DEFAULT_PREFS, ...readJson<Partial<PlayPrefs>>(PREFS_KEY, {}) });
  }, []);
  const change = (patch: Partial<PlayPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writeJson(PREFS_KEY, next);
  };
  const present = FACTIONS.filter(({ faction }) => combatants.some((combatant) => combatant.faction === faction));
  const who = (faction: Faction): Controller => prefs.factions[faction] ?? DEFAULT_PREFS.factions[faction] ?? "ai";
  const everyone = present.every(({ faction }) => who(faction) === "human");

  function start() {
    const control: PlayControl = {
      factions: Object.fromEntries(present.map(({ faction }) => [faction, who(faction)])),
      askReactions: prefs.askReactions,
      askOpportunityAttacks: prefs.askOpportunityAttacks
    };
    startPlay({ control, playbackSpeed: prefs.playbackSpeed });
  }

  return (
    <section className={styles.section} aria-label="Play setup">
      <div className={styles.sectionTitle}>
        <strong>Play this fight</strong>
        <span>you run your sides, the AI the rest</span>
      </div>
      {present.length === 0 ? <p className={styles.hint}>Add some creatures to the scene first.</p> : null}
      {present.map(({ faction, label }) => (
        <div key={faction} className={styles.row}>
          <span>{label}</span>
          <PlaySegmented
            label={`Who plays the ${label.toLowerCase()}`}
            value={who(faction)}
            options={[{ value: "human", label: "You" }, { value: "ai", label: "AI" }]}
            onChange={(controller) => change({ factions: { ...prefs.factions, [faction]: controller } })}
          />
        </div>
      ))}
      {present.length > 1 && !everyone ? (
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={() => change({ factions: Object.fromEntries(present.map(({ faction }) => [faction, "human"])) })}>
            You play everyone
          </button>
        </div>
      ) : null}
      <div className={styles.row}>
        <span>Ask before my creatures react</span>
        <Toggle label="Ask before my creatures react" checked={prefs.askReactions} onChange={(on) => change({ askReactions: on })} />
      </div>
      <div className={styles.row}>
        <span>… and before opportunity attacks</span>
        <Toggle label="Ask before opportunity attacks" checked={prefs.askOpportunityAttacks} onChange={(on) => change({ askOpportunityAttacks: on })} />
      </div>
      <div className={styles.row}>
        <span>The AI's turns</span>
        <PlaySegmented label="How the AI's turns play out" value={prefs.playbackSpeed} options={SPEED_OPTIONS} onChange={(speed) => change({ playbackSpeed: speed })} />
      </div>
      <p className={styles.hint}>The board as it is now is kept: you can put it back when you stop.</p>
      <div className={styles.buttons}>
        <button type="button" className={styles.primary} disabled={present.length === 0} onClick={start}>
          <Play size={14} /> Start
        </button>
        <button type="button" className={styles.button} onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
