import { useCallback, useEffect, useRef, useState } from "react";
import type { CombatLogEvent, EncounterSnapshot, Point } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { useIsReplaying } from "@/hooks/useDisplayEncounter";
import { areaFlashForEvent, combatTextForEvent, selectStepBatchCues, type FeedbackKind } from "@/lib/combatFeedback";

const TTL_MS = 1300;
const AREA_FLASH_TTL_MS = 1500;
/**
 * Cap on how many roll/damage/heal cues one Step (a whole automated turn) may
 * raise at once — `ActionDeclared` cues are exempt, see `selectStepBatchCues`.
 */
const STEP_BATCH_CAP = 6;
/** Stagger between cues raised in the same batch, so they don't perfectly overlap. */
const BATCH_STAGGER_MS = 90;

export interface ActiveFloatie {
  id: string;
  text: string;
  kind: FeedbackKind;
  /** Grid cell the cue floats from (snapshotted at spawn). */
  cell: Point;
  /** Horizontal px jitter so stacked cues fan out. */
  jitter: number;
  /** Animation delay for batch staggering. */
  delayMs: number;
  /** `performance.now()` when the cue becomes visible (spawn + delay). */
  bornAt: number;
}

export interface ActiveAreaFlash {
  id: string;
  /** Grid cells to paint, precomputed against the map at spawn. */
  cells: Point[];
  origin: Point;
  /** Concrete damage type for tinting, or `null` for the generic accent. */
  damageType: string | null;
  bornAt: number;
}

/**
 * Ephemeral "what just happened" feedback on the battlemap: floating action /
 * damage / healing text and a brief AoE-shape flash (see SCENE_FEEDBACK_PLAN.md,
 * Phases B & C).
 *
 * Cues are raised when the replay cursor advances **forward by exactly one**
 * (a play tick or a single-step) and when Step mode appends to the log — never
 * on a scrub jump, a rewind, or the initial jump into replay, so dragging the
 * slider doesn't spray feedback. Each cue self-expires.
 *
 * Takes the already-resolved display encounter (the replay-folded board when
 * replaying, the live one otherwise) so positions and the map are read from the
 * same frame the scene is drawing, without a second `useDisplayEncounter()` fold.
 */
export function useSceneFeedback(encounter: EncounterSnapshot): {
  floaties: ActiveFloatie[];
  areaFlashes: ActiveAreaFlash[];
} {
  const replayIndex = useEncounterStore((state) => state.replayIndex);
  const log = useEncounterStore((state) => state.log);
  const replaying = useIsReplaying();

  const [floaties, setFloaties] = useState<ActiveFloatie[]>([]);
  const [areaFlashes, setAreaFlashes] = useState<ActiveAreaFlash[]>([]);

  // Latest display encounter, read at spawn time without making it an effect dep.
  const encounterRef = useRef(encounter);
  encounterRef.current = encounter;

  const prevIndexRef = useRef<number | null>(replayIndex);
  const prevLenRef = useRef(log.length);

  const spawn = useCallback((events: CombatLogEvent[], batched: boolean) => {
    const now = performance.now();
    const { combatants, map } = encounterRef.current;
    const bornFloaties: ActiveFloatie[] = [];
    const bornFlashes: ActiveAreaFlash[] = [];

    events.forEach((event, index) => {
      const cue = combatTextForEvent(event);
      if (cue) {
        const anchor = combatants.find((combatant) => combatant.id === cue.anchorId);
        if (anchor) {
          const delayMs = batched ? index * BATCH_STAGGER_MS : 0;
          bornFloaties.push({
            id: `${event.id}:${cue.kind}:${now}:${index}`,
            text: cue.text,
            kind: cue.kind,
            cell: { x: anchor.position.x, y: anchor.position.y },
            jitter: Math.round((Math.random() * 2 - 1) * 10),
            delayMs,
            bornAt: now + delayMs
          });
        }
      }

      const flash = areaFlashForEvent(event, map);
      if (flash && flash.cells.length > 0) {
        bornFlashes.push({
          id: `${event.id}:flash:${now}:${index}`,
          cells: flash.cells,
          origin: flash.origin,
          damageType: flash.damageType,
          bornAt: now
        });
      }
    });

    if (bornFloaties.length) setFloaties((current) => [...current, ...bornFloaties]);
    if (bornFlashes.length) setAreaFlashes((current) => [...current, ...bornFlashes]);
  }, []);

  // Replay cursor: only a single forward step raises feedback.
  useEffect(() => {
    const prev = prevIndexRef.current;
    prevIndexRef.current = replayIndex;
    if (replayIndex == null) {
      setFloaties([]);
      setAreaFlashes([]);
      return;
    }
    if (prev != null && replayIndex === prev + 1) {
      const event = log[replayIndex - 1];
      if (event) spawn([event], false);
    }
  }, [replayIndex, log, spawn]);

  // Step mode: the store appends a whole turn at once. Replay drives itself via
  // the index above, so skip this path while replaying.
  useEffect(() => {
    const prevLen = prevLenRef.current;
    prevLenRef.current = log.length;
    if (replaying || log.length <= prevLen) return;
    const fresh = selectStepBatchCues(log.slice(prevLen), STEP_BATCH_CAP);
    if (fresh.length) spawn(fresh, true);
  }, [log, replaying, spawn]);

  // Sweep expired cues. One timer, only while something is on screen.
  useEffect(() => {
    if (floaties.length === 0 && areaFlashes.length === 0) return;
    const timer = setInterval(() => {
      const now = performance.now();
      setFloaties((current) => current.filter((floatie) => now - floatie.bornAt < TTL_MS));
      setAreaFlashes((current) => current.filter((flash) => now - flash.bornAt < AREA_FLASH_TTL_MS));
    }, 250);
    return () => clearInterval(timer);
  }, [floaties.length, areaFlashes.length]);

  return { floaties, areaFlashes };
}
