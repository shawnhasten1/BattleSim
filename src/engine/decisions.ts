import type { Ability, Id, Point, ReactionTrigger, ResourceCost } from "./types";

/* ─── Decision points ──────────────────────────────────────────────────────────
 * Choices the engine makes for a creature in the middle of resolving something: which reaction to take (opportunity
 * attacks included), whether to spend Legendary Resistance, which legendary or lair action to take and at what, each
 * swing of a multiattack after the first — and every roll, which a DM may overrule. Each site asks
 * `EngineState.decide` (through `askDecision`) and falls back to the AI's own choice when the answer is `undefined`,
 * so with no decider set (Auto Run, Batch) nothing changes.
 *
 * Play (play.ts) sets a decider that answers for the creatures a human plays. The engine is synchronous and can't
 * wait for a click, so when a human's answer isn't known yet the step finishes on the AI's choice, is thrown away, and
 * is run again from its start with the answer; the seed is the same, so everything up to the question repeats.
 */

/** How a roll came out, or how a DM rules it came out. For an attack, `"critical"` is a critical hit. */
export type RollOutcome = "success" | "failure" | "critical";

/** One reaction a creature could take for a trigger. */
export interface ReactionOption {
  actionId: Id;
  name: string;
  /** What it spends besides the reaction (a spell slot). */
  resourceCost?: ResourceCost;
  /** Who it acts on: the trigger's source (the attacker, caster or mover), its target, or the reactor itself. */
  targetId: Id;
  /** A counter: the slot it's cast with, and its chance of stopping the spell. */
  counter?: CounterOdds;
}

/** What a counter cast with one slot would do against the spell being cast. */
export interface CounterOdds {
  /** The slot level it's cast with: a spell no higher is stopped outright. */
  slot: number;
  /** A spell above the slot takes a check (DC `dcBase` + its level), else it can't be countered. */
  check?: { dcBase: number; modifier: number };
  /** With the spell's level known: its chance of stopping it (1 when certain), and the DC when it needs the check. */
  chance?: number;
  dc?: number;
  /** The 2024 Counterspell: the caster's save, against this DC, decides it. */
  casterSave?: { ability: Ability; dc: number };
}

/**
 * What a spell being cast would do to the counterer's side if it isn't stopped, in expected hit points: damage, the
 * chance it drops someone, conditions and how long they'd last, less what it does to the caster's own side, plus
 * healing and buffs it gives them. `basis: "level"` when the spell's effect couldn't be read (or isn't known), and it
 * was valued by its level instead.
 */
export interface SpellThreat {
  total: number;
  basis: "effect" | "level";
  creatures: SpellThreatLine[];
}

export interface SpellThreatLine {
  combatantId: Id;
  /** Whose side it's on, seen from the counterer. */
  side: "ours" | "theirs";
  damage: number;
  /** The expected damage would drop it. */
  likelyDown: boolean;
  conditions: Array<{ name: string; chance: number; turns: number }>;
  healing?: number;
  /** What it adds to the threat (negative for harm to the caster's side, which a counter would spare them). */
  value: number;
}

/** What a prompt shows about the trigger. */
export interface ReactionContext {
  /** The attack that triggered it: its roll against the AC, when it's known by now. */
  attack?: { actionId: Id; actionName: string; attackType: "melee" | "ranged" | "spell"; total?: number; natural?: number; targetAc?: number };
  /**
   * The spell being cast (Counterspell), and what it would do if let through. With the campaign rule
   * `counterspellReadsSpell` off, `known` is false: the counterer only sees that a spell is being cast (no name, level
   * or threat).
   */
  spell?: { actionId: Id; name: string; level: number; known?: boolean; threat?: SpellThreat };
  /** The mover's step out of reach (opportunity attacks). */
  step?: { from: Point; to: Point };
  /** Damage the reactor just took (Hellish Rebuke). */
  damageTaken?: number;
}

interface RequestBase {
  /** `${n}:${kind}:${subject}`, where `n` counts the decision points so far in this step (rolls included). */
  key: string;
}

export interface ReactionRequest extends RequestBase {
  kind: "reaction";
  reactorId: Id;
  trigger: ReactionTrigger["kind"];
  /** The attacker, caster or mover whose action opened the window. */
  sourceId: Id;
  /** The attack's target, when that isn't the reactor (Protection). */
  targetId?: Id;
  options: ReactionOption[];
  /** What the AI would take (null: nothing). "Always use" and the default for AI-played creatures. */
  aiChoice: Id | null;
  context: ReactionContext;
}

export interface LegendaryResistanceRequest extends RequestBase {
  kind: "legendary-resistance";
  combatantId: Id;
  /** The feature that grants it ("Legendary Resistance (3/Day)"). */
  feature: string;
  ability: Ability;
  dc: number;
  rolled: number;
  usesLeft: number;
  /** The name of what forced the save, when known. */
  against?: string;
  aiChoice: boolean;
}

/** One way to change a failed d20 roll: its feature, what it does, and what it costs (with what's left). */
export interface D20ChangeOption {
  id: string;
  name: string;
  does: string;
  cost?: { resourceId: string; amount: number; left: number };
}

export interface D20ChangeRequest extends RequestBase {
  kind: "d20-change";
  combatantId: Id;
  /** Whose roll it is, when another creature's (Countercharm, Boon of Fate): `combatantId` is the one who'd change it. */
  rollerId?: Id;
  /** The roll that failed: a save, or an attack roll that missed. */
  roll: "attack" | "save";
  /** A foe's roll that succeeded, which the change would make fail (Cutting Words). */
  succeeded?: boolean;
  natural: number;
  total: number;
  /** The DC or AC it had to reach. */
  against: number;
  /** What it was for ("Fireball", "Longsword"). */
  label?: string;
  options: D20ChangeOption[];
  /** What the AI would use (null: keep the roll). */
  aiChoice: string | null;
}

/** A legendary or lair action to take, and what at. */
export interface TurnPick {
  actionId: Id;
  targetIds?: Id[];
  aim?: Point;
  destination?: Point;
  moverId?: Id;
  optionId?: Id;
}

export interface TurnOption {
  actionId: Id;
  name: string;
  /** Legendary points it costs (1 for a lair action). */
  cost: number;
  /** The engine doesn't run it (Detect): taken, it spends its cost and is logged, and the DM applies it. */
  byHand?: boolean;
}

export interface TurnOptionRequest extends RequestBase {
  kind: "legendary-action" | "lair-action";
  combatantId: Id;
  /** Legendary: whose turn just ended. */
  afterId?: Id;
  /** Legendary: points left. */
  pointsLeft?: number;
  options: TurnOption[];
  /** The AI's pick, or null when it would pass. */
  aiChoice: TurnPick | null;
}

export interface SwingRequest extends RequestBase {
  kind: "multiattack-swing";
  attackerId: Id;
  /** The multiattack. */
  actionId: Id;
  /** This swing, counted from 1 among the routine's attacks, and how many it has. */
  swing: number;
  of: number;
  /** The attacks this swing can use. */
  candidates: Id[];
  previous?: { targetId: Id; actionId: Id; hit: boolean };
  targetedIds: Id[];
}

export interface RollRequest extends RequestBase {
  kind: "roll";
  /** Who rolled: the attacker, or the creature making the save or check. */
  rollerId: Id;
  /** A save to keep concentration is "concentration": it's logged apart from other saves (`ConcentrationChecked`). */
  purpose: "attack" | "save" | "concentration" | "death-save" | "check" | "recharge";
  /** The d20 (or recharge die) as it fell, and the total with bonuses. */
  natural: number;
  total: number;
  /** The AC or DC (or the recharge's minimum). */
  against?: number;
  outcome: RollOutcome;
  /** For an attack, its target. */
  targetId?: Id;
  /** What it was for ("Longsword", "Fireball", "Recharge 5–6"). */
  label?: string;
}

export type DecisionRequest = ReactionRequest | LegendaryResistanceRequest | TurnOptionRequest | SwingRequest | RollRequest | D20ChangeRequest;

export type ReactionAnswer = { kind: "reaction"; actionId: Id | null };
export type LegendaryResistanceAnswer = { kind: "legendary-resistance"; use: boolean };
export type TurnOptionAnswer = { kind: "legendary-action" | "lair-action"; pick: TurnPick | null };
export type SwingAnswer = { kind: "multiattack-swing"; skip?: boolean; targetId?: Id; actionId?: Id; moveTo?: Point; altitude?: number };
export type RollAnswer = { kind: "roll"; outcome: RollOutcome };
export type D20ChangeAnswer = { kind: "d20-change"; optionId: string | null };

export type DecisionAnswer = ReactionAnswer | LegendaryResistanceAnswer | TurnOptionAnswer | SwingAnswer | RollAnswer | D20ChangeAnswer;

type AnswerFor<R extends DecisionRequest> =
  R extends ReactionRequest ? ReactionAnswer
    : R extends LegendaryResistanceRequest ? LegendaryResistanceAnswer
      : R extends TurnOptionRequest ? TurnOptionAnswer
        : R extends SwingRequest ? SwingAnswer
          : R extends RollRequest ? RollAnswer
            : R extends D20ChangeRequest ? D20ChangeAnswer
              : never;

/** Answers a decision, or returns `undefined` to leave it to the AI (or keep the roll). */
export type Decider = (request: DecisionRequest) => DecisionAnswer | undefined;

/** The part of the engine state decisions use. */
export interface DecisionHost {
  decide?: Decider;
  /** Decision points so far in this step: the `n` of each key. */
  decisionCount?: number;
}

type WithoutKey<R> = R extends DecisionRequest ? Omit<R, "key"> : never;

/**
 * Ask the decider, if there is one. Every decision point goes through here (rolls included), so the keys count
 * every point of a step in the order the step reaches them — the same on every run of the step.
 */
export function askDecision<R extends DecisionRequest>(host: DecisionHost, request: WithoutKey<R>, subjectId: Id): AnswerFor<R> | undefined {
  if (!host.decide) return undefined;
  const n = host.decisionCount ?? 0;
  host.decisionCount = n + 1;
  const answer = host.decide({ ...request, key: `${n}:${request.kind}:${subjectId}` } as DecisionRequest);
  return answer && answer.kind === request.kind ? (answer as AnswerFor<R>) : undefined;
}

/** Whose choice a request is: the creature a human or the AI plays it for. */
export function decisionSubject(request: DecisionRequest): Id {
  switch (request.kind) {
    case "reaction": return request.reactorId;
    case "legendary-resistance": return request.combatantId;
    case "legendary-action":
    case "lair-action": return request.combatantId;
    case "multiattack-swing": return request.attackerId;
    case "roll": return request.rollerId;
    case "d20-change": return request.combatantId;
  }
}
