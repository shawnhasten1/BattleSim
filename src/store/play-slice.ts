import {
  buildBattleReport,
  playStatusOf,
  runPlayStep,
  type CombatCommand,
  type CombatLogEvent,
  type DecisionAnswer,
  type DecisionRequest,
  type EncounterSnapshot,
  type PlayControl,
  type PlayStatus,
  type PlayStep,
  type PlayStepResult,
  type RecordedAnswer,
  type SimulationOutcome
} from "@/engine";
import { deletePlaySetup, putPlaySetup } from "@/lib/playSetupStore";

/* ─── Play mode in the store (PLAY_MODE_PLAN.md §3.6) ─────────────────────────────
 * The fight goes forward one engine step at a time (`runPlayStep`): a person's command, or `advance` to the next turn
 * (played by the AI when it's the AI's). What a step finishes is committed to the live board as an undo step; the AI
 * turns an End turn sets off join its undo step, so undoing End turn returns to the person's turn. A question for a
 * person stays `pending` until it's answered, when the step runs again with the answer. What the AI did is played back
 * on the map, one turn at a time, before the next turn runs.
 */

/** How fast the AI's turns play back: 0 is instantly. */
export type PlaybackSpeed = 0 | 1 | 2 | 4;

export type PlaySessionStatus =
  /** A person's creature's turn is open. */
  | { kind: "your-turn"; actorId: string }
  /** The next turn is the AI's (or hasn't been opened yet). */
  | { kind: "ai" }
  | { kind: "over"; outcome: SimulationOutcome };

export interface PendingQuestion {
  step: PlayStep;
  /** The answers the step has had so far, in order. */
  answers: RecordedAnswer[];
  request: DecisionRequest;
  /** The board and the log when the question came up (not committed: the step is still running). */
  board: EncounterSnapshot;
  log: CombatLogEvent[];
  /** The undo step it will join. */
  group: string;
}

export interface PlaybackState {
  /** The board before the stretch being played back, and where it starts in the log. */
  base: EncounterSnapshot;
  from: number;
  /** How many events are shown so far. */
  index: number;
  /** Which log is played: the committed one, or a pending question's lead-up. */
  source: "log" | "pending";
}

export interface PlaySession {
  control: PlayControl;
  playbackSpeed: PlaybackSpeed;
  status: PlaySessionStatus;
  pending?: PendingQuestion;
  playback?: PlaybackState;
  /** Skip was pressed: the AI's turns run without playback until it's a person's turn again. */
  skipping?: boolean;
  /** The undo step the steps since a person's last command are joining. */
  undoGroup?: string;
  /** Why the last command didn't happen. */
  message?: string;
}

/** The part of the store the Play actions read and write. */
export interface PlayStoreState {
  encounter: EncounterSnapshot;
  log: CombatLogEvent[];
  play: PlaySession | null;
  playSetup: EncounterSnapshot | null;
}

export interface PlayActions {
  /** Start a fight in Play from the board as it is (kept as the setup). */
  startPlay: (options: { control: PlayControl; playbackSpeed: PlaybackSpeed }) => void;
  /** A person's command on their creature's open turn. */
  playCommand: (command: CombatCommand) => void;
  /** Answer the open question. */
  answerPrompt: (answer: DecisionAnswer) => void;
  /** Run the AI's turns until it's a person's turn, a question, or a playback. (After an undo, "Continue".) */
  continuePlay: () => void;
  /** Move the playback on one event; at the end, show the question or carry on. */
  advancePlayback: () => void;
  /** Skip the rest of the AI's turns' playback, to the next person's turn or question. */
  skipPlayback: () => void;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
  /** Who plays what. A person's open turn handed to the AI is played by it at once. */
  setPlayControl: (control: PlayControl) => void;
  dismissPlayMessage: () => void;
  /** Stop playing: keep the board as it is, or put back the setup. */
  endPlay: (options: { restoreSetup: boolean }) => void;
  /**
   * Keep the finished fight with its scene, as Auto Run's runs are kept: the board it started from (so a replay folds
   * the log onto it), the log, and `metrics.mode: "manual"` with who played what. False if it couldn't be.
   */
  savePlayedRun: () => Promise<boolean>;
}

export interface PlayApi<S extends PlayStoreState> {
  get: () => S;
  set: (partial: Partial<S>) => void;
  /**
   * Commit a step's board and log as an undo step, joining `group`'s step if it continues it — with Play's state after
   * it, in the same update, so nothing sees the new log without the playback that goes with it.
   */
  commitPlay: (encounter: EncounterSnapshot, log: CombatLogEvent[], group: string, outcome: SimulationOutcome | null, play: PlaySession) => void;
  /** Commit a whole new board (Reset to setup) as an undo step, clearing the log. */
  commitBoard: (encounter: EncounterSnapshot) => void;
  /** Where this scene's setup is kept (as its map image is). */
  setupKey: () => string;
  /** The saved scene this fight belongs to, if it's saved. */
  encounterId: () => string | null;
}

export function sessionStatusOf(status: PlayStatus): PlaySessionStatus {
  return status.kind === "your-turn" ? { kind: "your-turn", actorId: status.actorId }
    : status.kind === "over" ? { kind: "over", outcome: status.outcome }
      : { kind: "ai" };
}

/**
 * What's played back on the map: the AI's turns (and a turn handed to it), and a person's move — the token walks its
 * route, and an opportunity attack on the way happens where it does. A person's other commands show at once.
 */
function animates(step: PlayStep): boolean {
  return step.kind === "advance" || ["ai-turn", "end-turn", "move"].includes(step.command.kind);
}

/** The DM's hand on the board: it changes nothing about whose turn it is, and sets no turns going. */
function byTheDm(step: PlayStep): boolean {
  return step.kind === "command" && step.command.kind === "dm";
}

export function createPlayActions<S extends PlayStoreState>(api: PlayApi<S>): PlayActions {
  const { get, set } = api;
  let groupCount = 0;
  const newGroup = (label: string) => `play:${label}:${get().log.length}:${(groupCount += 1)}`;
  const update = (patch: Partial<PlaySession>) => {
    const play = get().play;
    if (play) set({ play: { ...play, ...patch } } as Partial<S>);
  };

  /** Apply a step's result: commit what finished, keep a question open, start the playback of what the AI did. */
  const handle = (result: PlayStepResult, step: PlayStep, playFrom: { base: EncounterSnapshot; from: number }, group: string) => {
    const play = get().play;
    if (!play) return;
    if (result.kind === "refused") {
      update({ message: result.reason });
      return;
    }
    const animate = play.playbackSpeed > 0 && !play.skipping && animates(step);
    if (result.kind === "needs-decision") {
      const pending: PendingQuestion = { step, answers: result.answers, request: result.request, board: result.board, log: result.log, group };
      const playback: PlaybackState | undefined = animate && result.log.length > playFrom.from
        ? { base: playFrom.base, from: playFrom.from, index: playFrom.from, source: "pending" }
        : undefined;
      update({ pending, playback, message: undefined });
      return;
    }
    const status = sessionStatusOf(result.status);
    const playback: PlaybackState | undefined = animate && result.log.length > playFrom.from
      ? { base: playFrom.base, from: playFrom.from, index: playFrom.from, source: "log" }
      : undefined;
    api.commitPlay(result.snapshot, result.log, group, status.kind === "over" ? status.outcome : null, {
      ...play,
      pending: undefined,
      playback,
      status,
      message: undefined,
      // The steps up to the next person's turn join this one's undo step (not the DM's: a turn going on after it is
      // its own).
      undoGroup: status.kind === "ai" && !byTheDm(step) ? group : byTheDm(step) ? play.undoGroup : undefined,
      skipping: status.kind === "ai" ? play.skipping : false
    });
  };

  /** Run `advance` steps while the AI has the next turn and nothing (a playback, a question) is in the way. */
  const runAiTurns = () => {
    for (let guard = 0; guard < 1000; guard += 1) {
      const { play, encounter, log } = get();
      if (!play || play.pending || play.playback || play.status.kind !== "ai") return;
      const group = play.undoGroup ?? newGroup("advance");
      const step: PlayStep = { kind: "advance" };
      handle(runPlayStep({ snapshot: encounter, log, step, control: play.control }), step, { base: encounter, from: log.length }, group);
    }
  };

  return {
    startPlay: ({ control, playbackSpeed }) => {
      if (get().play) return;
      const setup = structuredClone(get().encounter);
      void putPlaySetup(api.setupKey(), setup);
      set({
        play: { control, playbackSpeed, status: sessionStatusOf(playStatusOf(setup, control)) },
        playSetup: setup
      } as Partial<S>);
      runAiTurns();
    },

    playCommand: (command) => {
      const { play, encounter, log } = get();
      if (!play || play.pending || play.playback) return;
      const step: PlayStep = { kind: "command", command };
      handle(runPlayStep({ snapshot: encounter, log, step, control: play.control }), step, { base: encounter, from: log.length }, newGroup(command.kind));
      if (!byTheDm(step)) runAiTurns();
    },

    answerPrompt: (answer) => {
      const { play, encounter, log } = get();
      const pending = play?.pending;
      if (!play || !pending || play.playback) return;
      const answers = [...pending.answers, { key: pending.request.key, answer }];
      handle(
        runPlayStep({ snapshot: encounter, log, step: pending.step, control: play.control, answers }),
        pending.step,
        // What's still to show starts where the question's lead-up ended.
        { base: pending.board, from: pending.log.length },
        pending.group
      );
      runAiTurns();
    },

    continuePlay: () => runAiTurns(),

    advancePlayback: () => {
      const play = get().play;
      const playback = play?.playback;
      if (!play || !playback) return;
      const source = playback.source === "pending" ? play.pending?.log ?? [] : get().log;
      if (playback.index < source.length) {
        update({ playback: { ...playback, index: playback.index + 1 } });
        return;
      }
      update({ playback: undefined });
      runAiTurns();
    },

    skipPlayback: () => {
      const play = get().play;
      if (!play) return;
      // Skipping carries on only through AI turns still to come (or the rest of the step a question is holding).
      update({ playback: undefined, skipping: play.status.kind === "ai" || Boolean(play.pending) });
      runAiTurns();
    },

    setPlaybackSpeed: (speed) => update({ playbackSpeed: speed }),

    setPlayControl: (control) => {
      const play = get().play;
      if (!play) return;
      update({ control });
      // A person's open turn handed to the AI: the AI plays the rest of it now.
      const status = play.status;
      if (status.kind === "your-turn" && !play.pending && !play.playback
        && playStatusOf(get().encounter, control).kind !== "your-turn") {
        const step: PlayStep = { kind: "command", command: { kind: "ai-turn", actorId: status.actorId } };
        const { encounter, log } = get();
        handle(runPlayStep({ snapshot: encounter, log, step, control }), step, { base: encounter, from: log.length }, newGroup("ai-turn"));
        runAiTurns();
      }
    },

    dismissPlayMessage: () => update({ message: undefined }),

    savePlayedRun: async () => {
      const { play, playSetup, encounter, log } = get();
      const encounterId = api.encounterId();
      if (!play || play.status.kind !== "over" || !encounterId) return false;
      const outcome = play.status.outcome;
      const start = playSetup ?? encounter;
      try {
        const response = await fetch("/api/simulation-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            encounterId,
            seed: encounter.seed,
            outcome: outcome.winner ?? "round-limit",
            rounds: outcome.rounds,
            snapshot: start,
            metrics: { ...outcome, mode: "manual", control: play.control, dmEdits: buildBattleReport(start, log).dmEdits },
            eventLog: log
          })
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    endPlay: ({ restoreSetup }) => {
      const { playSetup } = get();
      if (restoreSetup && playSetup) api.commitBoard(structuredClone(playSetup));
      void deletePlaySetup(api.setupKey());
      set({ play: null, playSetup: null } as Partial<S>);
    }
  };
}

/** The log a playback reads: a question's lead-up, or the committed log. */
export function playbackLog(state: PlayStoreState): CombatLogEvent[] {
  return state.play?.playback?.source === "pending" ? state.play.pending?.log ?? [] : state.log;
}

/**
 * Persisted Play state: everything but the playback (a reload just shows the board) and a question's board and log,
 * which `restorePlay` rebuilds by running its step again.
 */
export function persistedPlay(play: PlaySession | null): PlaySession | null {
  if (!play) return null;
  const { playback: _playback, pending, ...rest } = play;
  return {
    ...rest,
    skipping: false,
    ...(pending ? { pending: { step: pending.step, answers: pending.answers, group: pending.group } as PendingQuestion } : {})
  };
}

/** Play state as it comes back from storage: a pending question rebuilt from its step and answers, or dropped if it can't be. */
export function restorePlay(play: PlaySession | null | undefined, encounter: EncounterSnapshot, log: CombatLogEvent[]): PlaySession | null {
  if (!play) return null;
  const restored: PlaySession = { ...play, playback: undefined, skipping: false };
  if (!play.pending) return restored;
  try {
    const result = runPlayStep({ snapshot: encounter, log, step: play.pending.step, control: play.control, answers: play.pending.answers });
    if (result.kind === "needs-decision") {
      return { ...restored, pending: { ...play.pending, request: result.request, board: result.board, log: result.log, answers: result.answers } };
    }
  } catch {
    // Fall through: the question can't be asked again on this board.
  }
  return { ...restored, pending: undefined, status: sessionStatusOf(playStatusOf(encounter, play.control)) };
}
