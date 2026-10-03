"use client";

import { FastForward, Play as PlayIcon, RotateCcw, Save, ScrollText, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDisplayEncounter } from "@/hooks/useDisplayEncounter";
import { usePlayPlayback } from "@/hooks/usePlayPlayback";
import { describeQuestion, type PromptPolicy } from "@/lib/play/questions";
import type { ReactionPolicy } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { playbackLog } from "@/store/play-slice";
import { playStatusText } from "./PlayControls";
import { PlaySegmented, POLICY_OPTIONS, SPEED_OPTIONS } from "./PlaySegmented";
import { Hotbar } from "./Hotbar";
import { overruleItems, RollStrip } from "./RollStrip";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { recentRolls } from "@/lib/play/rolls";
import { SwingCard } from "./SwingCard";
import { TurnOptionCard } from "./TurnOptionCard";
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
        <RollStrip />
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

/**
 * A question for you, over the map: the trigger and its numbers, and an answer per button. No timer. A reaction's
 * question also sets how it's handled for the rest of the fight: Always and Never answer this one too.
 */
function PromptCard() {
  const pending = useEncounterStore((state) => (state.play && !state.play.playback ? state.play.pending : undefined));
  const answerPrompt = useEncounterStore((state) => state.answerPrompt);
  const control = useEncounterStore((state) => state.play?.control);
  const setPlayControl = useEncounterStore((state) => state.setPlayControl);
  const play = useEncounterStore((state) => state.play);
  const overrideRoll = useEncounterStore((state) => state.overrideRoll);
  const [rollMenu, setRollMenu] = useState<{ x: number; y: number } | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, [pending?.request.key]);
  if (!pending) return null;
  // A swing, and a legendary or lair action, are aimed on the map, so their cards keep out of the way.
  if (pending.request.kind === "multiattack-swing") return <SwingCard request={pending.request} board={pending.board} />;
  if (pending.request.kind === "legendary-action" || pending.request.kind === "lair-action") return <TurnOptionCard request={pending.request} board={pending.board} />;
  const text = describeQuestion(pending.request, pending.board);
  // A question that shows a roll (Shield's attack roll, Legendary Resistance's save) can have that roll overruled.
  const request = pending.request;
  const shownRoll = request.kind === "reaction" && request.trigger === "would-be-hit"
    ? recentRolls(play).find((item) => item.request.purpose === "attack" && item.request.rollerId === request.sourceId && item.request.targetId === request.reactorId)
    : request.kind === "legendary-resistance"
      ? recentRolls(play).find((item) => item.request.purpose === "save" && item.request.rollerId === request.combatantId)
      : undefined;
  const setPolicy = (policy: PromptPolicy, value: ReactionPolicy) => {
    if (!control) return;
    setPlayControl({ ...control, reactions: { ...(control.reactions ?? {}), [policy.key]: value } });
    if (value === "use") answerPrompt(policy.use);
    else if (value === "never") answerPrompt({ kind: "reaction", actionId: null });
  };
  return (
    <div className={styles.prompt} role="dialog" aria-label={`${text.who} can choose`}>
      <span className={styles.promptWho}>{text.who}</span>
      <p className={styles.promptTitle}>{text.title}</p>
      {shownRoll ? (
        <button type="button" className={styles.dockLink} onClick={(event) => setRollMenu({ x: event.clientX, y: event.clientY })}>
          Overrule the roll…
        </button>
      ) : null}
      {shownRoll && rollMenu ? <ContextMenu x={rollMenu.x} y={rollMenu.y} items={overruleItems(shownRoll, overrideRoll)} onClose={() => setRollMenu(null)} /> : null}
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
      {text.policies?.length ? (
        <div className={styles.promptPolicies}>
          {text.policies.map((policy) => (
            <div key={policy.key} className={styles.row}>
              <span>{`${policy.label}, this fight`}</span>
              <PlaySegmented
                label={`${policy.label}, this fight`}
                value={control?.reactions?.[policy.key] ?? "ask"}
                options={POLICY_OPTIONS}
                onChange={(value) => setPolicy(policy, value)}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The end of the fight: who won, and what next. */
function PlayEndCard({ onOpenReport }: { onOpenReport?: () => void }) {
  const play = useEncounterStore((state) => state.play);
  const playSetup = useEncounterStore((state) => state.playSetup);
  const endPlay = useEncounterStore((state) => state.endPlay);
  const savePlayedRun = useEncounterStore((state) => state.savePlayedRun);
  const encounterId = useEncounterStore((state) => state.currentEncounterId);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "failed">("idle");
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
        <button
          type="button"
          className={styles.button}
          disabled={!encounterId || saving === "saving" || saving === "saved"}
          title={encounterId ? "Keep this fight with the scene: its log, who played what" : "Save the scene first: a run is kept with its scene"}
          onClick={async () => {
            setSaving("saving");
            setSaving((await savePlayedRun()) ? "saved" : "failed");
          }}
        >
          <Save size={14} /> {saving === "saved" ? "Saved" : saving === "failed" ? "Couldn't save: try again" : "Save this run"}
        </button>
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
