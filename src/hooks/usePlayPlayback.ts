import { useEffect } from "react";
import { dwellForEvent } from "@/lib/replay";
import { useEncounterStore } from "@/store/encounter-store";
import { playbackLog } from "@/store/play-slice";

/**
 * Plays the AI's turns back in Play: steps the playback one event at a time, dwelling on each as the replay does
 * (divided by the chosen speed), and lets the store carry on when it reaches the end — the next AI turn, a person's
 * turn, or a question. Mount it once, with the scene.
 */
export function usePlayPlayback(): void {
  const playback = useEncounterStore((state) => state.play?.playback);
  const speed = useEncounterStore((state) => state.play?.playbackSpeed ?? 1);
  const log = useEncounterStore(playbackLog);
  const advancePlayback = useEncounterStore((state) => state.advancePlayback);
  const index = playback?.index;

  useEffect(() => {
    if (index === undefined) return;
    const next = log[index];
    // Past the last event: hand back at once.
    const dwell = next ? dwellForEvent(next) / Math.max(0.25, speed || 1) : 0;
    const timer = window.setTimeout(advancePlayback, dwell);
    return () => window.clearTimeout(timer);
  }, [index, log, speed, advancePlayback]);
}
