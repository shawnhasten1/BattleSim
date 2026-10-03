"use client";

import { Bot, FastForward, Flag, Play as PlayIcon, RotateCcw, Square } from "lucide-react";
import { useState } from "react";
import type { CombatLogEvent, EncounterSnapshot } from "@/engine";
import { useDisplayEncounter } from "@/hooks/useDisplayEncounter";
import { describeQuestion } from "@/lib/play/questions";
import { useEncounterStore } from "@/store/encounter-store";
import { playbackLog, type PlaySession } from "@/store/play-slice";
import { PlaySegmented, SPEED_OPTIONS } from "./PlaySegmented";
import styles from "./play.module.css";

/**
 * Whose turn a playback is showing: the latest turn started before where it has got to, or — at its very start, before
 * any of it is shown — the first turn it's about to show. A playback that starts no turn (a person's move) is of the
 * turn already open.
 */
export function playbackActorId(play: PlaySession, log: CombatLogEvent[]): string | undefined {
  const playback = play.playback;
  if (!playback) return undefined;
  let actorId: string | undefined;
  for (let index = playback.from; index < log.length; index += 1) {
    const entry = log[index]!;
    if (entry.type !== "TurnStarted") continue;
    if (actorId === undefined || index < playback.index) actorId = String(entry.data?.combatantId);
    else break;
  }
  const base = playback.base;
  return actorId ?? (base.round > 0 ? base.combatants[base.turnIndex]?.id : undefined);
}

/** Where the fight stands, in words: whose turn, what's being waited on. */
export function playStatusText(play: PlaySession, board: EncounterSnapshot, log: CombatLogEvent[] = []): { label: string; text: string } {
  const name = (id: string | undefined) => board.combatants.find((combatant) => combatant.id === id)?.displayName ?? "Someone";
  if (play.playback) {
    const actorId = playbackActorId(play, log);
    return { label: `Round ${board.round}`, text: actorId ? `${name(actorId)}'s turn` : "The AI's turn" };
  }
  if (play.pending) return { label: "Waiting on you", text: `${describeQuestion(play.pending.request, play.pending.board).who} can choose` };
  switch (play.status.kind) {
    case "your-turn": return { label: `Round ${board.round} · your turn`, text: name(play.status.actorId) };
    case "ai": return { label: board.round > 0 ? `Round ${board.round}` : "Ready", text: board.round > 0 ? "The AI's turn is next" : "Roll initiative to begin" };
    case "over": return { label: "The fight is over", text: play.status.outcome.winner ? `${play.status.outcome.winner === "party" ? "The party" : play.status.outcome.winner === "enemy" ? "The enemies" : play.status.outcome.winner} won in round ${play.status.outcome.rounds}` : "Nobody is left standing" };
  }
}

/**
 * The Combat panel while a fight is played: where it stands, the turn's buttons (End turn, hand it to the AI), the AI's
 * playback speed and Skip, and stopping — keeping the board, or putting the setup back.
 */
export function PlayControls() {
  const play = useEncounterStore((state) => state.play)!;
  const playSetup = useEncounterStore((state) => state.playSetup);
  const playCommand = useEncounterStore((state) => state.playCommand);
  const continuePlay = useEncounterStore((state) => state.continuePlay);
  const skipPlayback = useEncounterStore((state) => state.skipPlayback);
  const setPlaybackSpeed = useEncounterStore((state) => state.setPlaybackSpeed);
  const endPlay = useEncounterStore((state) => state.endPlay);
  const board = useDisplayEncounter();
  const log = useEncounterStore(playbackLog);
  const [stopping, setStopping] = useState(false);
  const status = playStatusText(play, board, log);
  const idle = !play.playback && !play.pending;
  const yourTurn = idle && play.status.kind === "your-turn" ? play.status.actorId : undefined;

  return (
    <section className={styles.section} aria-label="Play">
      <div className={styles.status} aria-live="polite">
        <span>{status.label}</span>
        <strong>{status.text}</strong>
      </div>
      {play.message ? <p className={styles.hint} role="alert">{play.message}</p> : null}
      <div className={styles.buttons}>
        {yourTurn ? (
          <>
            <button type="button" className={styles.primary} onClick={() => playCommand({ kind: "end-turn", actorId: yourTurn })}>
              <Flag size={14} /> End turn
            </button>
            <button type="button" className={styles.button} onClick={() => playCommand({ kind: "ai-turn", actorId: yourTurn })} title="The AI plays the rest of this turn, then ends it">
              <Bot size={14} /> AI: take this turn
            </button>
          </>
        ) : null}
        {idle && play.status.kind === "ai" ? (
          <button type="button" className={styles.primary} onClick={continuePlay}>
            <PlayIcon size={14} /> {board.round > 0 ? "Continue" : "Begin"}
          </button>
        ) : null}
        {play.playback ? (
          <button type="button" className={styles.button} onClick={skipPlayback} title="Skip to your next turn or question">
            <FastForward size={14} /> Skip
          </button>
        ) : null}
      </div>
      <div className={styles.row}>
        <span>The AI's turns</span>
        <PlaySegmented label="How the AI's turns play out" value={play.playbackSpeed} options={SPEED_OPTIONS} onChange={setPlaybackSpeed} />
      </div>
      {stopping ? (
        <div className={styles.buttons} role="group" aria-label="Stop playing">
          <button type="button" className={styles.button} onClick={() => endPlay({ restoreSetup: false })}>
            <Square size={13} /> Keep the board
          </button>
          <button type="button" className={styles.danger} disabled={!playSetup} onClick={() => endPlay({ restoreSetup: true })} title={playSetup ? "Put the board back as it was when you started" : "The setup isn't here (it's kept in this browser)"}>
            <RotateCcw size={13} /> Reset to setup
          </button>
          <button type="button" className={styles.button} onClick={() => setStopping(false)}>Cancel</button>
        </div>
      ) : (
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={() => setStopping(true)}>
            <Square size={13} /> Stop playing
          </button>
        </div>
      )}
    </section>
  );
}
