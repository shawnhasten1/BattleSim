/**
 * The rolls a DM can overrule in Play (PLAY_MODE_PLAN.md §2.10): those made since a person's last command, newest
 * first, in words ("Goblin 1 → Fighter (Scimitar): 9 + 4 = 13 against AC 16, miss"), with the outcomes each can be
 * ruled to, and which log entry each is. Pure.
 */
import type { CombatLogEvent, EncounterSnapshot, Id, RollOutcome, RollRequest } from "@/engine";
import type { PlaySession } from "@/store/play-slice";

export interface RollItem {
  /** Which of the steps since the last command made it (`play.recent[stepIndex]`), and its key there. */
  stepIndex: number;
  key: string;
  /** The roll, with its outcome as ruled. */
  request: RollRequest;
  /** How the dice had it, when the DM overruled it. */
  rolled?: RollOutcome;
  /** How long the log was when it was rolled. */
  logLength: number;
}

/** The rolls since the last command, newest first, as ruled; while a playback runs, only those it has shown. */
export function recentRolls(play: PlaySession | null): RollItem[] {
  if (!play?.recent) return [];
  const shownUpTo = play.playback ? play.playback.index : Number.POSITIVE_INFINITY;
  const items = play.recent.flatMap((entry, stepIndex) => entry.rolls.map((roll): RollItem => {
    const ruled = entry.overrides[roll.key];
    return ruled
      ? { stepIndex, key: roll.key, request: { ...roll.request, outcome: ruled }, rolled: roll.request.outcome, logLength: roll.logLength }
      : { stepIndex, key: roll.key, request: roll.request, logLength: roll.logLength };
  }));
  return items.filter((item) => item.logLength < shownUpTo).reverse();
}

const nameOf = (board: EncounterSnapshot, id: Id | undefined) => board.combatants.find((combatant) => combatant.id === id)?.displayName ?? "Someone";
const signed = (value: number) => (value < 0 ? `− ${-value}` : `+ ${value}`);

/** How a roll came out, in a word. */
export function outcomeWord(request: Pick<RollRequest, "purpose" | "outcome">): string {
  if (request.purpose === "attack") return request.outcome === "critical" ? "critical hit" : request.outcome === "success" ? "hit" : "miss";
  if (request.purpose === "recharge") return request.outcome === "failure" ? "not recharged" : "recharged";
  return request.outcome === "failure" ? "failure" : "success";
}

/** A roll, in a line: who, against whom or what, the numbers, and how it came out (and, overruled, how the dice had it). */
export function describeRoll(request: RollRequest, board: EncounterSnapshot, rolled?: RollOutcome): string {
  const line = rollLine(request, board);
  return rolled ? `${line} (DM override; the dice said ${outcomeWord({ purpose: request.purpose, outcome: rolled })})` : line;
}

function rollLine(request: RollRequest, board: EncounterSnapshot): string {
  const roller = nameOf(board, request.rollerId);
  const bonus = request.total - request.natural;
  const sum = bonus === 0 ? `${request.total}` : `${request.natural} ${signed(bonus)} = ${request.total}`;
  switch (request.purpose) {
    case "attack":
      return `${roller} → ${nameOf(board, request.targetId)}${request.label ? ` (${request.label})` : ""}: ${sum} against AC ${request.against}, ${outcomeWord(request)}`;
    case "save":
      return `${roller}'s save${request.label ? ` against ${request.label}` : ""}: ${sum} against DC ${request.against}, ${outcomeWord(request)}`;
    case "concentration":
      return `${roller}'s save to keep concentrating: ${sum} against DC ${request.against}, ${outcomeWord(request)}`;
    case "death-save":
      return `${roller}'s death save: ${request.natural}, ${outcomeWord(request)}`;
    case "check":
      return `${roller}: ${request.label ?? "a check"}, ${sum} against DC ${request.against}, ${outcomeWord(request)}`;
    case "recharge":
      return `${roller}'s ${request.label ?? "recharge"}: rolled ${request.natural}, needs ${request.against}+, ${outcomeWord(request)}`;
  }
}

/** What a roll can be ruled to instead: an attack a hit, a critical hit or a miss; anything else the other way. */
export function overrideChoices(request: Pick<RollRequest, "purpose" | "outcome">): Array<{ outcome: RollOutcome; label: string }> {
  const all: Array<{ outcome: RollOutcome; label: string }> = request.purpose === "attack"
    ? [{ outcome: "success", label: "Hit" }, { outcome: "critical", label: "Critical hit" }, { outcome: "failure", label: "Miss" }]
    : request.purpose === "recharge"
      ? [{ outcome: "success", label: "Recharged" }, { outcome: "failure", label: "Not recharged" }]
      : [{ outcome: "success", label: "Success" }, { outcome: "failure", label: "Failure" }];
  return all.filter((choice) => choice.outcome !== request.outcome);
}

/** The log entry each kind of roll writes, and who it's about. */
function matches(entry: CombatLogEvent, request: RollRequest): boolean {
  const data = entry.data ?? {};
  switch (request.purpose) {
    case "attack": return entry.type === "AttackRolled" && data.attackerId === request.rollerId && data.targetId === request.targetId;
    case "save": return entry.type === "SaveRolled" && data.targetId === request.rollerId;
    case "concentration": return entry.type === "ConcentrationChecked" && data.combatantId === request.rollerId;
    case "death-save": return entry.type === "DeathSaveRolled" && data.combatantId === request.rollerId;
    case "check": return (entry.type === "EscapeAttempted" || entry.type === "CounterspellCheck") && data.combatantId === request.rollerId;
    case "recharge": return entry.type === "AbilityRecharged" && data.combatantId === request.rollerId;
  }
}

/**
 * Which log entry is which roll: each roll's entry is the first of its kind about its roller from where it was rolled,
 * not already another's. Keyed by the entry's place in the log.
 */
export function rollsByLogIndex(log: CombatLogEvent[], items: RollItem[]): Map<number, RollItem> {
  const out = new Map<number, RollItem>();
  for (const item of [...items].sort((a, b) => a.logLength - b.logLength)) {
    for (let index = item.logLength; index < log.length; index += 1) {
      if (!out.has(index) && matches(log[index]!, item.request)) {
        out.set(index, item);
        break;
      }
    }
  }
  return out;
}
