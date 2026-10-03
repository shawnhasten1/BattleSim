"use client";

import { FastForward, Play as PlayIcon, RotateCcw, ScrollText, Square, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useDisplayEncounter } from "@/hooks/useDisplayEncounter";
import { usePlayPlayback } from "@/hooks/usePlayPlayback";
import { describeQuestion } from "@/lib/play/questions";
import { useEncounterStore } from "@/store/encounter-store";
import { playbackLog } from "@/store/play-slice";
import { playStatusText } from "./PlayControls";
import { PlaySegmented, SPEED_OPTIONS } from "./PlaySegmented";
import { Hotbar } from "./Hotbar";
import { SwingCard } from "./SwingCard";
import { TurnBar } from "./TurnBar";
import type { PlayMoveView } from "@/hooks/usePlayMove";
import type { AimView } from "@/hooks/usePlayAim";
import styles from "./play.module.css";

/**
 * Everything Play puts over the map: the turn bar and a banner at the top (whose turn, the AI's playback speed and
 * Skip), the hotbar on your creature's turn, a question for you, and the card at the end. It also runs the AI's turns'
 * playback.
 */
export function PlayOverlay({ onOpenReport, move, aim }: { onOpenReport?: () => void; move?: PlayMoveView | null; aim?: AimView | null }) {
  usePlayPlayback();
  return (
    <>
      <div className={styles.overlayTop}>
        <TurnBar />
        <PlayBanner />
        <PlayNote />
      </div>
      <Hotbar move={move} aim={aim} />
      <PromptCard />
      <PlayEndCard onOpenReport={onOpenReport} />
    </>
  );
}

function PlayBanner() {
  const play = useEncounterStore((state) => state.play);
  const playCommand = useEncounterStore((state) => state.playCommand);
  const continuePlay = useEncounterStore((state) => state.continuePlay);
  const skipPlayback = useEncounterStore((state) => state.skipPlayback);
  const setPlaybackSpeed = useEncounterStore((state) => state.setPlaybackSpeed);
  const board = useDisplayEncounter();
  const log = useEncounterStore(playbackLog);
  if (!play) return null;
  // A question has its own card, and the end its own; the banner stays out of the way.
  if (!play.playback && (play.pending || play.status.kind === "over")) return null;
  const status = playStatusText(play, board, log);
  if (play.playback) {
    return (
      <div className={styles.banner} aria-live="polite">
        <strong>{status.text}</strong>
        <PlaySegmented label="How the AI's turns play out" value={play.playbackSpeed} options={SPEED_OPTIONS.filter((option) => option.value !== 0)} onChange={setPlaybackSpeed} />
        <button type="button" className={styles.button} onClick={skipPlayback} title="Skip to your next turn or question">
          <FastForward size={13} /> Skip
        </button>
      </div>
    );
  }
  if (play.status.kind === "your-turn") {
    // The turn's own buttons are on the hotbar.
    return (
      <div className={styles.banner} data-tone="you" aria-live="polite">
        <span>Your turn:</span>
        <strong>{status.text}</strong>
        <span className={styles.bannerRound}>{`Round ${board.round}`}</span>
      </div>
    );
  }
  return (
    <div className={styles.banner}>
      <strong>{status.text}</strong>
      <button type="button" className={styles.primary} onClick={continuePlay}>
        <PlayIcon size={13} /> {board.round > 0 ? "Continue" : "Begin"}
      </button>
    </div>
  );
}

/** Why the last command didn't happen (out of reach, no action left…), under the banner until the next one does. */
function PlayNote() {
  const message = useEncounterStore((state) => state.play?.message);
  const dismissPlayMessage = useEncounterStore((state) => state.dismissPlayMessage);
  if (!message) return null;
  return (
    <div className={styles.banner} data-tone="note" role="alert">
      <span>{message}</span>
      <button type="button" className={styles.button} onClick={dismissPlayMessage} aria-label="Dismiss"><X size={13} /></button>
    </div>
  );
}

/** A question for you, over the map: the trigger and its numbers, and an answer per button. No timer. */
function PromptCard() {
  const pending = useEncounterStore((state) => (state.play && !state.play.playback ? state.play.pending : undefined));
  const answerPrompt = useEncounterStore((state) => state.answerPrompt);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, [pending?.request.key]);
  if (!pending) return null;
  // A swing is aimed on the map, so its card keeps out of the way.
  if (pending.request.kind === "multiattack-swing") return <SwingCard request={pending.request} board={pending.board} />;
  const text = describeQuestion(pending.request, pending.board);
  return (
    <div className={styles.prompt} role="dialog" aria-label={`${text.who} can choose`}>
      <span className={styles.promptWho}>{text.who}</span>
      <p className={styles.promptTitle}>{text.title}</p>
      <p className={styles.promptAsk}>{text.ask}</p>
      <div className={styles.promptOptions}>
        {text.options.map((option, index) => (
          <button
            key={`${option.label}-${index}`}
            ref={option.primary ? primaryRef : undefined}
            type="button"
            className={option.primary ? styles.primary : styles.button}
            onClick={() => answerPrompt(option.answer)}
          >
            <span>{option.label}</span>
            {option.detail ? <small>{option.detail}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The end of the fight: who won, and what next. */
function PlayEndCard({ onOpenReport }: { onOpenReport?: () => void }) {
  const play = useEncounterStore((state) => state.play);
  const playSetup = useEncounterStore((state) => state.playSetup);
  const endPlay = useEncounterStore((state) => state.endPlay);
  const board = useDisplayEncounter();
  if (!play || play.playback || play.status.kind !== "over") return null;
  const status = playStatusText(play, board);
  return (
    <div className={styles.endCard} role="dialog" aria-label="The fight is over">
      <span className={styles.promptWho}>{status.label}</span>
      <p className={styles.endTitle}>{status.text}</p>
      <div className={styles.buttons}>
        {onOpenReport ? (
          <button type="button" className={styles.primary} onClick={onOpenReport}>
            <ScrollText size={14} /> Battle report
          </button>
        ) : null}
        <button type="button" className={styles.danger} disabled={!playSetup} onClick={() => endPlay({ restoreSetup: true })}>
          <RotateCcw size={14} /> Reset to setup
        </button>
        <button type="button" className={styles.button} onClick={() => endPlay({ restoreSetup: false })}>
          <Square size={13} /> Keep the board
        </button>
      </div>
    </div>
  );
}
