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

/**
 * The encounter to *render*. In replay mode this is the pre-run board with the
 * event log folded forward to the scrubber position; otherwise it's the live,
 * editable encounter straight from the store. Only the scene canvas and the
 * combat panel's turn readouts consume this — every editing surface keeps
 * reading `state.encounter` so tuning tweaks always target the real setup.
 */
export function useDisplayEncounter(): EncounterSnapshot {
  const encounter = useEncounterStore((state) => state.encounter);
  const replayBase = useEncounterStore((state) => state.replayBase);
  const replayIndex = useEncounterStore((state) => state.replayIndex);
  const log = useEncounterStore((state) => state.log);
  const replaying = useIsReplaying();

  return useMemo(() => {
    if (!replaying || replayBase == null || replayIndex == null) return encounter;
    return replayTo(replayBase, log, replayIndex);
  }, [replaying, encounter, replayBase, replayIndex, log]);
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
