"use client";

import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useEncounterStore } from "@/store/encounter-store";
import { useReplayCursorEvent } from "@/hooks/useDisplayEncounter";
import { useReplayPlayback } from "@/hooks/useReplayPlayback";
import { describeEvent } from "@/lib/replay";
import { AiDecisionCard } from "./AiDecisionCard";
import styles from "./ReplayBar.module.css";

/**
 * Transport for the event-log replay ("watch mode"): scrubber, play / step
 * controls, speed, the running "now showing" line, the AI decision inspector
 * for the parked event, and a click-to-scrub raw log. Rendered by CombatPanel
 * only while `useReplayPlayback().active` is true.
 */
export function ReplayBar() {
  const playback = useReplayPlayback();
  const log = useEncounterStore((state) => state.log);
  const cursorEvent = useReplayCursorEvent();

  const activeLogRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeLogRef.current?.scrollIntoView({ block: "nearest" });
  }, [playback.index]);

  if (!playback.active) return null;

  const { index, logLength } = playback;
  const contextEvent = cursorEvent ?? log[index] ?? null;
  const roundLabel = index <= 0
    ? "Start"
    : contextEvent
      ? `Round ${contextEvent.round}${contextEvent.round > 0 ? ` · turn ${contextEvent.turnIndex + 1}` : ""}`
      : "End";

  return (
    <section className={styles.bar} aria-label="Replay controls">
      <header className={styles.head}>
        <strong>Replay</strong>
        <span className={styles.count}>{index} / {logLength}</span>
        <button type="button" className={styles.exit} onClick={playback.exit} title="Exit replay (back to setup)">
          <X size={14} /> Exit
        </button>
      </header>

      <div className={styles.nowShowing}>
        <span>{roundLabel}</span>
        <strong>{describeEvent(cursorEvent ?? undefined)}</strong>
      </div>

      <input
        className={styles.scrubber}
        type="range"
        min={0}
        max={logLength}
        value={index}
        aria-label="Replay position"
        onChange={(event) => playback.scrubTo(Number(event.target.value))}
      />

      <div className={styles.transport}>
        <button type="button" onClick={playback.toFirst} disabled={playback.atStart} title="Jump to start">
          <SkipBack size={15} />
        </button>
        <button type="button" onClick={playback.stepBack} disabled={playback.atStart} title="Step back">
          <ChevronLeft size={15} />
        </button>
        <button type="button" className={styles.playToggle} onClick={playback.toggle} data-primary title={playback.playing ? "Pause" : "Play"}>
          {playback.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button type="button" onClick={playback.stepForward} disabled={playback.atEnd} title="Step forward">
          <ChevronRight size={15} />
        </button>
        <button type="button" onClick={playback.toLast} disabled={playback.atEnd} title="Jump to end">
          <SkipForward size={15} />
        </button>
      </div>

      <div className={styles.speeds} role="group" aria-label="Playback speed">
        {playback.speeds.map((option) => (
          <button
            key={option}
            type="button"
            className={option === playback.speed ? styles.speedOn : ""}
            onClick={() => playback.setSpeed(option)}
          >
            {option}×
          </button>
        ))}
      </div>

      {cursorEvent?.type === "AiDecision" ? <AiDecisionCard event={cursorEvent} /> : null}

      <details className={styles.logWrap}>
        <summary>Event log</summary>
        <ol className={styles.logList}>
          {log.map((entry, entryIndex) => {
            const isCurrent = entryIndex === index - 1;
            return (
              <li key={entry.id} ref={isCurrent ? activeLogRef : undefined}>
                <button
                  type="button"
                  className={isCurrent ? styles.logCurrent : ""}
                  onClick={() => playback.scrubTo(entryIndex + 1)}
                >
                  <span className={styles.logNum}>{entryIndex + 1}</span>
                  <span className={styles.logMsg}>{entry.message}</span>
                  <small>{entry.type}</small>
                </button>
              </li>
            );
          })}
        </ol>
      </details>
    </section>
  );
}
