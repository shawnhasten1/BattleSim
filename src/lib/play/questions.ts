import {
  findActionDefinition,
  getDefinition,
  type Ability,
  type DecisionAnswer,
  type DecisionRequest,
  type EncounterSnapshot,
  type ReactionRequest
} from "@/engine";
import { costText } from "@/lib/statblock";

/**
 * What a Play prompt says: whose choice it is, the question with the numbers behind it, and an answer per button.
 * Pure, so the wording is tested without rendering. Legendary and lair actions, and a multiattack's next swing, are
 * aimed on the map; until the prompt can do that it offers the AI's own pick, or passing.
 */
export interface PromptOption {
  label: string;
  /** What it costs or does, beside the label. */
  detail?: string;
  answer: DecisionAnswer;
  /** The one to press for "yes". */
  primary?: boolean;
}

export interface PromptText {
  /** The creature whose choice it is. */
  who: string;
  title: string;
  /** The question itself, under the title. */
  ask: string;
  options: PromptOption[];
}

const ABILITY_NAMES: Record<Ability, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

function ordinal(level: number): string {
  const suffix = level % 100 >= 11 && level % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[level % 10] ?? "th";
  return `${level}${suffix}`;
}

const nameOf = (board: EncounterSnapshot, id: string | undefined) =>
  board.combatants.find((combatant) => combatant.id === id)?.displayName ?? "Someone";

export function describeQuestion(request: DecisionRequest, board: EncounterSnapshot): PromptText {
  switch (request.kind) {
    case "reaction":
      return describeReaction(request, board);
    case "legendary-resistance":
      return {
        who: nameOf(board, request.combatantId),
        title: `${nameOf(board, request.combatantId)} failed a DC ${request.dc} ${ABILITY_NAMES[request.ability]} save${request.against ? ` against ${request.against}` : ""} (rolled ${request.rolled}).`,
        ask: `Use ${request.feature} (${request.usesLeft} left) to succeed instead?`,
        options: [
          { label: `Use ${request.feature.replace(/\s*\(.*\)$/, "")}`, detail: `${request.usesLeft - 1} left after`, answer: { kind: "legendary-resistance", use: true }, primary: true },
          { label: "Fail the save", answer: { kind: "legendary-resistance", use: false } }
        ]
      };
    case "legendary-action":
    case "lair-action": {
      const who = nameOf(board, request.combatantId);
      const pick = request.aiChoice;
      const picked = pick ? request.options.find((option) => option.actionId === pick.actionId) : undefined;
      const target = pick?.targetIds?.[0] ? nameOf(board, pick.targetIds[0]) : pick?.aim ? `(${pick.aim.x}, ${pick.aim.y})` : undefined;
      return {
        who,
        title: request.kind === "legendary-action"
          ? `${who} can take a legendary action after ${nameOf(board, request.afterId)}'s turn (${request.pointsLeft} left).`
          : `${who}'s lair acts on initiative 20.`,
        ask: picked ? `The AI would use ${picked.name}${target ? ` on ${target}` : ""}.` : "The AI would let this one pass.",
        options: [
          ...(pick && picked ? [{ label: `Use ${picked.name}`, detail: target ? `on ${target}` : undefined, answer: { kind: request.kind, pick }, primary: true } as PromptOption] : []),
          { label: "Pass", answer: { kind: request.kind, pick: null } }
        ]
      };
    }
    case "multiattack-swing":
      return {
        who: nameOf(board, request.attackerId),
        title: `${nameOf(board, request.attackerId)}: swing ${request.swing} of ${request.of}.`,
        ask: "Swing as the routine would, or skip it?",
        options: [
          { label: "Swing", answer: { kind: "multiattack-swing" }, primary: true },
          { label: "Skip it", answer: { kind: "multiattack-swing", skip: true } }
        ]
      };
    case "roll":
      return {
        who: nameOf(board, request.rollerId),
        title: `${nameOf(board, request.rollerId)} rolled ${request.total}${request.against !== undefined ? ` against ${request.against}` : ""}.`,
        ask: "Keep it?",
        options: [{ label: "Keep it", answer: { kind: "roll", outcome: request.outcome }, primary: true }]
      };
  }
}

function describeReaction(request: ReactionRequest, board: EncounterSnapshot): PromptText {
  const reactor = nameOf(board, request.reactorId);
  const source = nameOf(board, request.sourceId);
  const attack = request.context.attack;
  const reactorCombatant = board.combatants.find((combatant) => combatant.id === request.reactorId);
  const reactorDefinition = reactorCombatant ? getDefinition(board, reactorCombatant) : undefined;
  // What a reaction raises the AC to, when that's what it does (Shield, Parry).
  const raisedAc = (actionId: string) => {
    const action = reactorDefinition ? findActionDefinition(reactorDefinition, actionId) : undefined;
    const gain = action?.kind === "activate-feature" ? action.condition?.modifiers?.armorClass ?? 0 : 0;
    return gain > 0 && attack?.targetAc !== undefined ? attack.targetAc + gain : undefined;
  };
  const options: PromptOption[] = request.options.map((option, index) => {
    const ac = request.trigger === "would-be-hit" ? raisedAc(option.actionId) : undefined;
    const details = [
      option.resourceCost ? costText(option.resourceCost) : undefined,
      ac !== undefined && attack?.total !== undefined ? `AC ${ac}: ${attack.total < ac ? "the attack misses" : "it still hits"}` : undefined
    ].filter(Boolean);
    return {
      label: option.name,
      detail: details.length ? details.join(" · ") : undefined,
      answer: { kind: "reaction", actionId: option.actionId },
      primary: index === 0
    };
  });
  options.push({ label: "Don't", answer: { kind: "reaction", actionId: null } });

  switch (request.trigger) {
    case "enemy-leaves-reach":
      return { who: reactor, title: `${source} is leaving ${reactor}'s reach.`, ask: "Make an opportunity attack?", options };
    case "would-be-hit":
      return {
        who: reactor,
        title: `${source}'s ${attack?.actionName ?? "attack"} hits ${reactor}${attack?.total !== undefined && attack.targetAc !== undefined ? `: ${attack.total} against AC ${attack.targetAc}` : ""}.`,
        ask: "React before the damage?",
        options
      };
    case "targeted-by-attack":
      return { who: reactor, title: `${source} attacks ${reactor}${attack ? ` with ${attack.actionName}` : ""}.`, ask: "React before the roll?", options };
    case "hit-by-attack":
      return {
        who: reactor,
        title: `${source} hit ${reactor}${request.context.damageTaken !== undefined ? ` for ${request.context.damageTaken}` : ""}.`,
        ask: "React?",
        options
      };
    case "ally-targeted-by-attack":
      return { who: reactor, title: `${source} attacks ${nameOf(board, request.targetId)}, near ${reactor}.`, ask: "Give the attack disadvantage?", options };
    case "enemy-casts-spell": {
      const spell = request.context.spell;
      return {
        who: reactor,
        title: `${source} is casting ${spell?.name ?? "a spell"}${spell?.level ? ` (${ordinal(spell.level)} level)` : ""}.`,
        ask: "Counter it?",
        options
      };
    }
    case "manual":
      return { who: reactor, title: `${reactor} can react.`, ask: "React?", options };
  }
}
