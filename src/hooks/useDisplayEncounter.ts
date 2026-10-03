import { useMemo } from "react";
import type { CombatLogEvent, EncounterSnapshot } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { describeEvent, replayTo } from "@/lib/replay";

/**
 * True while the replay scrubber / "watch mode" is driving what's on screen.
 * Requires a real event log so a stale `replayBase` left over from a project
 * load (which clears `log`) never counts.
 */
export function useIsReplaying(): boolean {
  const replayIndex = useEncounterStore((state) => state.replayIndex);
  const replayBase = useEncounterStore((state) => state.replayBase);
  const logLength = useEncounterStore((state) => state.log.length);
  return replayIndex != null && replayBase != null && logLength > 0;
}

/** True while Play is playing back what the AI did (or the lead-up to a question). */
export function useIsPlayingBack(): boolean {
  return useEncounterStore((state) => Boolean(state.play?.playback));
}

/**
 * Whatever is playing a stretch of the log back on the map right now: the replay scrubber over an Auto Run
 * (`"review"`), or Play showing the AI's turns one at a time (`"play"`). The board is `base` with the events from
 * `from` up to `index` folded onto it. The scene's tweens, path walks and floating cues follow this, whichever it is.
 */
export interface PlaybackCursor {
  mode: "review" | "play" | null;
  base: EncounterSnapshot | null;
  log: CombatLogEvent[];
  index: number | null;
  from: number;
}

export function usePlaybackCursor(): PlaybackCursor {
  const replaying = useIsReplaying();
  const replayBase = useEncounterStore((state) => state.replayBase);
  const replayIndex = useEncounterStore((state) => state.replayIndex);
  const log = useEncounterStore((state) => state.log);
  const playback = useEncounterStore((state) => state.play?.playback);
  const pendingLog = useEncounterStore((state) => state.play?.pending?.log);
  return useMemo((): PlaybackCursor => {
    if (replaying && replayBase && replayIndex != null) return { mode: "review", base: replayBase, log, index: replayIndex, from: 0 };
    if (playback) {
      return { mode: "play", base: playback.base, log: playback.source === "pending" ? pendingLog ?? [] : log, index: playback.index, from: playback.from };
    }
    return { mode: null, base: null, log, index: null, from: 0 };
  }, [replaying, replayBase, replayIndex, log, playback, pendingLog]);
}

/**
 * The encounter to *render*. In replay mode this is the pre-run board with the
 * event log folded forward to the scrubber position; in Play, while the AI's turn
 * plays back, the board before it with that turn's events folded on, and while a
 * question waits, the board as it was when it came up. Otherwise it's the live,
 * editable encounter straight from the store. Only the scene canvas and the
 * combat panel's turn readouts consume this — every editing surface keeps
 * reading `state.encounter` so tuning tweaks always target the real setup.
 */
export function useDisplayEncounter(): EncounterSnapshot {
  const encounter = useEncounterStore((state) => state.encounter);
  const questionBoard = useEncounterStore((state) => (state.play && !state.play.playback ? state.play.pending?.board : undefined));
  const cursor = usePlaybackCursor();

  return useMemo(() => {
    if (cursor.mode && cursor.base && cursor.index != null) return replayTo(cursor.base, cursor.log, cursor.index, cursor.from);
    return questionBoard ?? encounter;
  }, [cursor, questionBoard, encounter]);
}

/** The log event the scrubber is currently parked on (the last one applied). */
export function useReplayCursorEvent(): CombatLogEvent | null {
  const replayIndex = useEncounterStore((state) => state.replayIndex);
  const log = useEncounterStore((state) => state.log);
  const replaying = useIsReplaying();
  if (!replaying || replayIndex == null || replayIndex <= 0) return null;
  return log[replayIndex - 1] ?? null;
}

export { describeEvent };
