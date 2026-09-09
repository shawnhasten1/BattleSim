import { useCallback, useEffect, useRef, useState } from "react";
import { useEncounterStore } from "@/store/encounter-store";
import { dwellForEvent } from "@/lib/replay";
import { readJson, writeJson } from "@/lib/persist";

const SPEED_KEY = "replay-speed";
export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;

/**
 * Timed playback ("watch mode") for the replay scrubber. The scrub position
 * itself lives in the store (so the scene can tween to it); the *timer* and the
 * play/pause intent live here, keeping the store free of interval handles.
 *
 * Playback auto-starts when a run drops the UI into replay at index 0, pauses
 * itself on reaching the end, and dwells on each event for a type-dependent
 * beat divided by the chosen speed.
 */
export function useReplayPlayback() {
  const replayIndex = useEncounterStore((state) => state.replayIndex);
  const replayBase = useEncounterStore((state) => state.replayBase);
  const log = useEncounterStore((state) => state.log);
  const speed = useEncounterStore((state) => state.replaySpeed);
  const setReplayIndex = useEncounterStore((state) => state.setReplayIndex);
  const setReplaySpeed = useEncounterStore((state) => state.setReplaySpeed);
  const exitReplay = useEncounterStore((state) => state.exitReplay);

  const active = replayBase != null && replayIndex != null;
  const logLength = log.length;
  const atEnd = replayIndex != null && replayIndex >= logLength;
  const atStart = replayIndex != null && replayIndex <= 0;

  const [playing, setPlaying] = useState(false);

  // Restore the persisted speed once, after mount (never during render — SSR).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const saved = readJson<number | null>(SPEED_KEY, null);
    if (saved && REPLAY_SPEEDS.includes(saved as (typeof REPLAY_SPEEDS)[number])) {
      setReplaySpeed(saved);
    }
    setHydrated(true);
  }, [setReplaySpeed]);
  useEffect(() => {
    if (!hydrated) return;
    writeJson(SPEED_KEY, speed);
  }, [hydrated, speed]);

  // Auto-start playback the moment a run enters replay at the beginning.
  const prevIndexRef = useRef<number | null>(replayIndex);
  useEffect(() => {
    const prev = prevIndexRef.current;
    prevIndexRef.current = replayIndex;
    if (prev == null && replayIndex === 0 && logLength > 0) {
      setPlaying(true);
    }
    if (replayIndex == null) {
      setPlaying(false);
    }
  }, [replayIndex, logLength]);

  // The advance timer.
  useEffect(() => {
    if (!playing || !active || replayIndex == null || replayIndex >= logLength) return;
    const dwell = dwellForEvent(log[replayIndex]) / Math.max(0.1, speed);
    const timer = setTimeout(() => setReplayIndex(replayIndex + 1), dwell);
    return () => clearTimeout(timer);
  }, [playing, active, replayIndex, logLength, speed, log, setReplayIndex]);

  // Stop when we run out of log.
  useEffect(() => {
    if (atEnd) setPlaying(false);
  }, [atEnd]);

  const play = useCallback(() => {
    if (atEnd) setReplayIndex(0);
    setPlaying(true);
  }, [atEnd, setReplayIndex]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);
  const stepForward = useCallback(() => {
    setPlaying(false);
    if (replayIndex != null) setReplayIndex(replayIndex + 1);
  }, [replayIndex, setReplayIndex]);
  const stepBack = useCallback(() => {
    setPlaying(false);
    if (replayIndex != null) setReplayIndex(replayIndex - 1);
  }, [replayIndex, setReplayIndex]);
  const toFirst = useCallback(() => {
    setPlaying(false);
    setReplayIndex(0);
  }, [setReplayIndex]);
  const toLast = useCallback(() => {
    setPlaying(false);
    setReplayIndex(logLength);
  }, [logLength, setReplayIndex]);
  const scrubTo = useCallback(
    (index: number) => {
      setPlaying(false);
      setReplayIndex(index);
    },
    [setReplayIndex]
  );

  return {
    active,
    playing,
    atEnd,
    atStart,
    index: replayIndex ?? 0,
    logLength,
    speed,
    speeds: REPLAY_SPEEDS,
    setSpeed: setReplaySpeed,
    play,
    pause,
    toggle,
    stepForward,
    stepBack,
    toFirst,
    toLast,
    scrubTo,
    exit: exitReplay
  };
}
