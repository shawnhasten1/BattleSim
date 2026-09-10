import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Point } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { clamp } from "@/components/scene/coords";
import { useIsReplaying } from "@/hooks/useDisplayEncounter";

export interface ReplayPathWalk {
  /** Transient per-combatant cell position while a move is being traced. */
  positions: Map<string, Point>;
  /** Per-hop tween duration (ms) for the walking token, or `null` when idle. */
  hopMs: number | null;
}

const IDLE: ReplayPathWalk = { positions: new Map(), hopMs: null };

/**
 * While watch-mode playback steps forward onto a `CombatantMoved` event, walk
 * the token cell-by-cell along the route the engine actually took (`data.cells`)
 * instead of letting it slide straight to the destination. `replayTo` has
 * already parked the token on the final cell, so this override rewinds it to the
 * path start and advances one cell per `hopMs` beat; once the trace finishes the
 * override drops and the token renders from its real position again.
 *
 * Only a single-step advance (playback, or the step-forward button) traces the
 * path; dragging the slider or jumping stays instant, so scrubbing never feels
 * sluggish. A started trace runs to completion even as playback advances to
 * later events — it's only cut short if the same token moves again.
 *
 * @param slideMs the tween the token would otherwise use for a straight slide;
 *   the whole walk is spread across roughly this budget so pacing matches the
 *   rest of replay.
 */
export function useReplayPathWalk(slideMs: number): ReplayPathWalk {
  const replaying = useIsReplaying();
  const replayIndex = useEncounterStore((state) => state.replayIndex);
  const log = useEncounterStore((state) => state.log);
  const [walk, setWalk] = useState<ReplayPathWalk>(IDLE);
  const prevIndexRef = useRef<number | null>(replayIndex);
  const timersRef = useRef<{ interval: number; settle: number } | null>(null);

  const stop = () => {
    if (timersRef.current) {
      window.clearInterval(timersRef.current.interval);
      window.clearTimeout(timersRef.current.settle);
      timersRef.current = null;
    }
  };

  // Layout effect so the token is seeded at the path start *before* paint — the
  // frame where `replayTo` shows it at the destination never reaches the screen.
  useLayoutEffect(() => {
    const prev = prevIndexRef.current;
    prevIndexRef.current = replayIndex;

    const steppedForward = prev != null && replayIndex != null && replayIndex === prev + 1;
    const moveEvent = steppedForward && replayIndex != null ? log[replayIndex - 1] : undefined;
    const data = moveEvent?.data ?? {};
    const combatantId = typeof data.combatantId === "string" ? data.combatantId : null;
    const cells = Array.isArray(data.cells) ? (data.cells as Point[]) : null;

    // < 3 cells is a single hop — the plain slide already traces it correctly.
    if (moveEvent?.type !== "CombatantMoved" || !replaying || !combatantId || !cells || cells.length < 3) {
      return;
    }

    stop();
    const segments = cells.length - 1;
    const hopMs = Math.round(clamp(slideMs / segments, 45, slideMs));
    let step = 0;
    setWalk({ positions: new Map([[combatantId, cells[0]!]]), hopMs });

    const interval = window.setInterval(() => {
      step += 1;
      setWalk({ positions: new Map([[combatantId, cells[step]!]]), hopMs });
      if (step >= segments) {
        window.clearInterval(interval);
        // Hold the (now real) final cell for one more hop so that last segment
        // eases like the others, then hand rendering back to the real position.
        const settle = window.setTimeout(() => {
          timersRef.current = null;
          setWalk(IDLE);
        }, hopMs);
        if (timersRef.current) timersRef.current.settle = settle;
      }
    }, hopMs);
    timersRef.current = { interval, settle: 0 };
  }, [replaying, replayIndex, log, slideMs]);

  // Leaving replay entirely drops any in-flight trace.
  useEffect(() => {
    if (!replaying) {
      stop();
      setWalk((current) => (current.hopMs == null ? current : IDLE));
    }
  }, [replaying]);

  // Cancel on unmount.
  useEffect(() => stop, []);

  return walk;
}
