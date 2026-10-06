import {
  expectedDamageCut,
  findActionDefinition,
  getDefinition,
  OPPORTUNITY_ATTACKS,
  previewAttack,
  previewSave,
  reactionPolicyKey,
  spatialDistance,
  spellNameOf,
  upcastBaseId,
  type Ability,
  type DecisionAnswer,
  type DecisionRequest,
  type EncounterSnapshot,
  type ReactionOption,
  type ReactionRequest,
  type SpellThreat
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

/** A standing order a prompt can set for the rest of the fight (D3): ask each time, always take it, or never. */
export interface PromptPolicy {
  /** `reactionPolicyKey(reactor, OPPORTUNITY_ATTACKS or the reaction's id)`. */
  key: string;
  /** What it covers: "Opportunity attacks", "Shield". */
  label: string;
  /** The answer "always" gives this time. */
  use: DecisionAnswer;
}

export interface PromptText {
  /** The creature whose choice it is. */
  who: string;
  title: string;
  /** The question itself, under the title. */
  ask: string;
  options: PromptOption[];
  /** The standing orders it can set. */
  policies?: PromptPolicy[];
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

const percent = (chance: number) => `${Math.round(chance * 100)}%`;
const amount = (value: number) => `${Math.round(value * 10) / 10}`;

/** What taking `option` would do, in numbers: the chance to hit or to fail and the damage, the AC it gives, the slot it spends. */
function optionDetail(request: ReactionRequest, board: EncounterSnapshot, option: ReactionOption): string | undefined {
  const reactor = board.combatants.find((combatant) => combatant.id === request.reactorId);
  if (!reactor) return undefined;
  const action = findActionDefinition(getDefinition(board, reactor), option.actionId);
  const attack = request.context.attack;
  const parts: string[] = [];
  try {
    if (action?.kind === "attack") {
      const preview = previewAttack(board, reactor.id, option.targetId, option.actionId);
      if (!preview.problem) parts.push(`${percent(preview.hitChance)} to hit`, `${amount(preview.damageOnHit)} damage`);
    } else if (action?.kind === "save" && option.targetId !== reactor.id) {
      const preview = previewSave(board, reactor.id, option.targetId, option.actionId);
      if (!preview.problem) parts.push(`${percent(preview.failChance)} to fail`, `${amount(preview.damageOnFail)} damage`);
    }
  } catch {
    // A preview that can't be made leaves the numbers out.
  }
  // Shield, Parry: the AC it gives, and whether that turns the hit.
  const gain = action?.kind === "activate-feature" ? action.condition?.modifiers?.armorClass ?? 0 : 0;
  if (request.trigger === "would-be-hit" && gain > 0 && attack?.targetAc !== undefined && attack.total !== undefined) {
    const ac = attack.targetAc + gain;
    parts.push(`AC ${ac}: ${attack.total < ac ? "the attack misses" : "it still hits"}`);
  }
  if (request.trigger === "enemy-casts-spell") parts.push(counterOdds(option));
  if (request.trigger === "would-take-damage" && action?.kind === "activate-feature" && action.damageCut) {
    const incoming = request.context.damageTaken ?? 0;
    const cut = Math.round(expectedDamageCut(action, getDefinition(board, reactor), incoming));
    parts.push(action.damageCut.kind === "reduce" ? `about ${cut} less (${incoming - cut} taken)` : `${incoming - cut} taken instead of ${incoming}`);
  }
  if (request.trigger === "ally-targeted-by-attack") parts.push("the attack has disadvantage");
  const cost = option.resourceCost;
  if (cost) {
    const left = reactor.resources?.[cost.resourceId];
    parts.push(`${costText(cost)}${left !== undefined ? ` (${left} left)` : ""}`);
  }
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * What a counter cast with this slot would do: "certain", "check DC 15 (45%)", or, with the spell unseen, "certain up to
 * 3rd level, a check above".
 */
function counterOdds(option: ReactionOption): string {
  const odds = option.counter;
  if (!odds) return "it's countered";
  if (odds.chance === undefined) {
    return `certain up to ${ordinal(odds.slot)} level${odds.check ? ", a check above" : ", not above"}`;
  }
  if (odds.chance >= 1) return "certain";
  return odds.dc !== undefined ? `check DC ${odds.dc} (${percent(odds.chance)})` : percent(odds.chance);
}

/** A list in words: "Ana", "Ana and Bo", "Ana, Bo and Cy". */
function listed(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * What a spell would do if let through, from the counterer's `SpellThreat`: "At Ana, Bo, Cy and Dee: ≈28 damage each,
 * may drop Cy." "65% to leave Bo paralyzed, ≈3 turns." "Heals Ogre ≈10." Empty when it can't be read.
 */
export function threatWords(threat: SpellThreat | undefined, board: EncounterSnapshot): string {
  if (!threat) return "";
  if (threat.basis === "level") return "What it does can't be read: weighed by its level.";
  const name = (id: string) => nameOf(board, id);
  const sentences: string[] = [];
  const hit = threat.creatures.filter((line) => line.damage >= 0.5);
  if (hit.length) {
    const damages = hit.map((line) => Math.round(line.damage));
    const low = Math.min(...damages);
    const high = Math.max(...damages);
    const each = hit.length === 1 ? `≈${low} damage` : high - low <= 3 ? `≈${Math.round(damages.reduce((sum, value) => sum + value, 0) / damages.length)} damage each` : `≈${low}–${high} damage`;
    const down = hit.filter((line) => line.likelyDown).map((line) => name(line.combatantId));
    sentences.push(`At ${listed(hit.map((line) => name(line.combatantId)))}: ${each}${down.length ? `, may drop ${listed(down)}` : ""}.`);
  }
  for (const line of threat.creatures) {
    for (const condition of line.conditions) {
      const turns = Math.round(condition.turns * 10) / 10;
      sentences.push(`${percent(condition.chance)} to leave ${name(line.combatantId)} ${condition.name}, ≈${turns} ${turns === 1 ? "turn" : "turns"}.`);
    }
    if (line.healing) sentences.push(`Heals ${name(line.combatantId)} ≈${Math.round(line.healing)}.`);
  }
  if (!sentences.length && threat.creatures.length) sentences.push(`On ${listed(threat.creatures.map((line) => name(line.combatantId)))}.`);
  return sentences.join(" ");
}

function describeReaction(request: ReactionRequest, board: EncounterSnapshot): PromptText {
  const reactor = nameOf(board, request.reactorId);
  const source = nameOf(board, request.sourceId);
  const attack = request.context.attack;
  const reactorCombatant = board.combatants.find((combatant) => combatant.id === request.reactorId);
  const sourceCombatant = board.combatants.find((combatant) => combatant.id === request.sourceId);
  const distance = (otherId: string | undefined) => {
    const other = board.combatants.find((combatant) => combatant.id === otherId);
    return reactorCombatant && other ? spatialDistance(board, reactorCombatant, other) : undefined;
  };
  // A counter is offered slot by slot, the AI's pick first in line ("Don't" when it wouldn't); anything else, in order.
  const counters = request.trigger === "enemy-casts-spell" && request.options.some((option) => option.counter);
  const options: PromptOption[] = request.options.map((option, index) => ({
    label: counters && option.counter ? `${ordinal(option.counter.slot)}-level slot` : option.name,
    detail: optionDetail(request, board, option),
    answer: { kind: "reaction", actionId: option.actionId },
    primary: counters ? option.actionId === request.aiChoice : index === 0
  }));
  options.push({ label: "Don't", answer: { kind: "reaction", actionId: null }, ...(counters && request.aiChoice === null ? { primary: true } : {}) });
  // Opportunity attacks are set as one; any other reaction on its own, at every slot (Counterspell is one setting).
  const families = [...new Map(request.options.map((option) => [upcastBaseId(option.actionId), option])).entries()];
  const policies: PromptPolicy[] = request.trigger === "enemy-leaves-reach"
    ? [{ key: reactionPolicyKey(request.reactorId, OPPORTUNITY_ATTACKS), label: "Opportunity attacks", use: { kind: "reaction", actionId: request.aiChoice ?? request.options[0]?.actionId ?? null } }]
    : families.map(([family, option]) => {
      const inFamily = request.options.filter((candidate) => upcastBaseId(candidate.actionId) === family);
      const pick = inFamily.find((candidate) => candidate.actionId === request.aiChoice)
        ?? [...inFamily].sort((a, b) => (b.counter?.chance ?? 0) - (a.counter?.chance ?? 0) || (a.counter?.slot ?? 0) - (b.counter?.slot ?? 0))[0]!;
      return { key: reactionPolicyKey(request.reactorId, family), label: spellNameOf(option.name), use: { kind: "reaction", actionId: pick.actionId } };
    });
  const text = (title: string, ask: string): PromptText => ({ who: reactor, title, ask, options, policies });

  switch (request.trigger) {
    case "enemy-leaves-reach":
      return text(`${source} is leaving ${reactor}'s reach.`, "Make an opportunity attack?");
    case "would-be-hit":
      return text(
        `${source}'s ${attack?.actionName ?? "attack"} hits ${reactor}${attack?.total !== undefined && attack.targetAc !== undefined ? `: ${attack.total} against AC ${attack.targetAc}` : ""}.`,
        "React before the damage?"
      );
    case "targeted-by-attack":
      return text(`${source} attacks ${reactor}${attack ? ` with ${attack.actionName}` : ""}.`, "React before the roll?");
    case "hit-by-attack":
      return text(`${source} hit ${reactor}${request.context.damageTaken !== undefined ? ` for ${request.context.damageTaken}` : ""}.`, `${request.options.length === 1 ? `${request.options[0]!.name} ${source}` : "React"}?`);
    case "would-take-damage":
      return text(
        `${reactor} is about to take ${request.context.damageTaken ?? "some"} damage${request.sourceId !== request.reactorId ? ` from ${source}` : ""}.`,
        "Cut it before it lands?"
      );
    case "ally-targeted-by-attack": {
      const away = distance(request.targetId);
      return text(`${source} attacks ${nameOf(board, request.targetId)}${away !== undefined ? `, ${away} ft. from ${reactor}` : ""}.`, "Give the attack disadvantage?");
    }
    case "enemy-casts-spell": {
      // With the campaign's rule off, a counterer only sees that a spell is being cast.
      const spell = request.context.spell?.known === false ? undefined : request.context.spell;
      const away = sourceCombatant ? distance(sourceCombatant.id) : undefined;
      const stakes = threatWords(spell?.threat, board);
      return text(
        `${source} is casting ${spell?.name ? spellNameOf(spell.name) : "a spell"}${spell?.level ? ` (${ordinal(spell.level)} level)` : ""}${away !== undefined ? ` ${away} ft. away` : ""}.${stakes ? ` ${stakes}` : ""}`,
        "Counter it?"
      );
    }
    case "manual":
      return text(`${reactor} can react.`, "React?");
  }
}
