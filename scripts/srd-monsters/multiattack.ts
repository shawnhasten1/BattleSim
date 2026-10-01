import type { ActionDefinition, AttackActionDefinition, MultiattackActionDefinition, MultiattackGeneric, MultiattackStep } from "../../src/engine/types";
import type { MonsterContext, RawEntry } from "./context";
import { uniqueId } from "./context";
import { averageDice } from "./util";

const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};
const COUNT = "(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d*d\\d+)";
const POSSESSIVE = "(?:its|his|her|their|a|an|the)";
const GENERIC = new Set(["melee", "ranged", "weapon"]);

function toCount(word: string, ctx: MonsterContext, note: string): number {
  const lower = word.toLowerCase();
  if (lower in COUNT_WORDS) return COUNT_WORDS[lower]!;
  // A rolled count (violet fungus: 1d4 attacks) — use the rounded average.
  ctx.gaps.add("MULTIATTACK_PARSE", `${note}: rolled attack count "${word}" approximated by its average`);
  return Math.max(1, Math.round(averageDice(lower)));
}

function norm(text: string): string {
  return text.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z ]/g, "").trim();
}

function singular(word: string): string {
  return word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

type Own = Pick<AttackActionDefinition, "id" | "name" | "attackType">;

function findOwn(word: string, own: Own[]): Own | undefined {
  const target = singular(norm(word));
  if (!target) return undefined;
  const names = own.map((action) => ({ action, name: singular(norm(action.name)) }));
  return (
    names.find((entry) => entry.name === target)
    ?? names.find((entry) => entry.name.startsWith(target))
    ?? names.find((entry) => entry.name.includes(target) || target.includes(entry.name))
  )?.action;
}

/** A routine the parser found: its steps, the text it came from, and a label when it isn't the attacks it uses. */
interface Variant {
  attacks: MultiattackStep[];
  text: string;
  label?: string;
}

/** Own attacks that stand on their own (the "(Two-Handed)" copies are alternatives of the same weapon). */
function primaryAttacks(own: Own[]): Own[] {
  return own.filter((action) => !/-two-handed$/.test(action.id));
}

/** Parses one sentence into one or more routines, or reports why it couldn't. */
function parseSentence(sentence: string, own: Own[], ctx: MonsterContext, note: string): Variant[] | { unresolved: string } | null {
  const lower = sentence.toLowerCase();
  if (!/\bmakes?\b/.test(lower) || !/attack/.test(lower)) return null;

  const colon = /attacks?:\s*(.*)$/i.exec(sentence);
  if (colon) {
    const item = new RegExp(`${COUNT}\\s+(?:melee\\s+|ranged\\s+)?(?:attacks?\\s+)?with\\s+${POSSESSIVE}\\s+([a-z' -]+?)(?=,|\\s+and\\b|\\.|$|\\s+or\\b)`, "gi");
    // "two with its spear (humanoid form) or one with its bite and one with its claws (hybrid form)":
    // form notes are noise, and "or" separates alternatives, each its own routine.
    const alternatives: Variant[] = [];
    for (const option of colon[1]!.replace(/\([^)]*\)/g, "").split(/\s+or\s+(?=(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d*d\d+)\s+(?:melee\s+|ranged\s+)?(?:attacks?\s+)?with\b)/i)) {
      const steps: MultiattackStep[] = [];
      for (const match of option.matchAll(item)) {
        const found = findOwn(match[2]!, own);
        if (!found) return { unresolved: `"${match[2]}"` };
        steps.push({ actionId: found.id, count: toCount(match[1]!, ctx, note) });
      }
      if (steps.length > 0) alternatives.push({ attacks: steps, text: sentence });
    }
    if (alternatives.length > 0) return alternatives;
  }

  const named = new RegExp(`\\bmakes?\\s+${COUNT}\\s+([a-z' -]+?)\\s+attacks?\\b`, "i").exec(sentence);
  if (named && !GENERIC.has(named[2]!.toLowerCase().trim())) {
    const found = findOwn(named[2]!, own);
    if (!found) return { unresolved: `"${named[2]}"` };
    return [{ attacks: [{ actionId: found.id, count: toCount(named[1]!, ctx, note) }], text: sentence }];
  }

  const countMatch = new RegExp(`\\bmakes?\\s+${COUNT}\\s+(?:(melee|ranged|weapon)\\s+)?attacks?\\b`, "i").exec(sentence);
  if (!countMatch) return null;
  const count = toCount(countMatch[1]!, ctx, note);

  // "…makes three attacks, either with its longsword or its longbow" → one routine per named weapon.
  const either = new RegExp(`(?:either|with either)\\s+(?:with\\s+)?${POSSESSIVE}\\s+([a-z' -]+?)\\s+or\\s+${POSSESSIVE}\\s+([a-z' -]+?)(?=[.,]|$)`, "i").exec(sentence);
  if (either) {
    const found = [either[1]!, either[2]!].map((word) => findOwn(word, own));
    if (found.some((action) => !action)) return { unresolved: `"${either[1]}" or "${either[2]}"` };
    return found.map((action) => ({ attacks: [{ actionId: action!.id, count }], text: sentence }));
  }

  // "…makes two attacks, only one of which can be a bite" → all of the plain attack, or one of it and the bite.
  const only = /only one of which can be (?:a |an |with its |with )?([a-z' -]+?)(?=[.,]|$|\s+attack)/i.exec(sentence);
  if (only) {
    const limited = findOwn(only[1]!, own);
    const plain = primaryAttacks(own).filter((action) => action.id !== limited?.id && action.attackType === "melee");
    if (!limited || plain.length === 0) return { unresolved: `"only one of which can be ${only[1]}"` };
    return [
      { attacks: [{ actionId: plain[0]!.id, count }], text: sentence },
      { attacks: [{ actionId: plain[0]!.id, count: count - 1 }, { actionId: limited.id, count: 1 }].filter((step) => step.count > 0), text: sentence, label: limited.name }
    ];
  }

  const kind = (countMatch[2]?.toLowerCase() ?? "weapon") as MultiattackGeneric;
  const candidates = primaryAttacks(own).filter((action) => kind === "ranged" ? action.attackType === "ranged" : kind === "melee" ? action.attackType === "melee" : action.attackType !== "spell");

  // "…makes two attacks with its chains", "…makes two ranged attacks with its daggers": that attack, however many.
  const withIts = new RegExp(`^\\s+with\\s+${POSSESSIVE}\\s+([a-z' -]+?)(?=[.,]|\\s+and\\b|$)`, "i").exec(sentence.slice(countMatch.index + countMatch[0].length));
  const weapon = withIts ? findOwn(withIts[1]!, kind === "weapon" ? own : own.filter((action) => action.attackType === kind)) : undefined;
  if (withIts && !weapon) return { unresolved: `"${withIts[1]}"` };
  if (weapon) return [{ attacks: [{ actionId: weapon.id, count }], text: sentence }];

  // "makes two melee attacks", "makes three attacks": any of its attacks of that kind, chosen swing by swing.
  if (candidates.length === 0) return { unresolved: `"${countMatch[0]}" with no matching attacks` };
  return [{ attacks: [{ any: kind, count }], text: sentence }];
}

/* ─── statblocks the parser doesn't read: written out here, by attack name ─── */

interface StepSpec {
  /** An attack or ability of the creature, by name. */
  name?: string;
  any?: MultiattackGeneric;
  count?: number;
  target?: MultiattackStep["target"];
  requiresPreviousHit?: boolean;
}

interface RoutineSpec {
  label?: string;
  steps: StepSpec[];
}

interface MultiattackSpec {
  routines: RoutineSpec[];
  /** Statblock sentences the routine doesn't run, shown as not simulated. */
  unsimulated?: string[];
}

const bite = (count = 1): StepSpec => ({ name: "Bite", count });

/**
 * Multiattacks with replacements, dependent attacks, target rules or alternatives the sentence parser can't read, each
 * checked against SRD 5.1. Steps name the creature's own attacks; an option is a whole routine.
 */
const ROUTINES: Record<string, MultiattackSpec> = {
  behir: { routines: [{ steps: [bite(), { name: "Constrict" }] }] },
  "barbed-devil": { routines: [{ steps: [{ name: "Tail" }, { name: "Claw", count: 2 }] }, { label: "Hurl Flame", steps: [{ name: "Hurl Flame", count: 2 }] }] },
  chimera: {
    routines: [
      { steps: [bite(), { name: "Horns" }, { name: "Claws" }] },
      { label: "Fire Breath for its bite", steps: [{ name: "Fire Breath" }, { name: "Horns" }, { name: "Claws" }] },
      { label: "Fire Breath for its horns", steps: [bite(), { name: "Fire Breath" }, { name: "Claws" }] }
    ]
  },
  chuul: { routines: [{ steps: [{ name: "Pincer", count: 2 }] }], unsimulated: ["If the chuul is grappling a creature, it can also use its tentacles once."] },
  "dragon-turtle": { routines: [{ steps: [bite(), { name: "Claw", count: 2 }] }, { label: "Tail", steps: [bite(), { name: "Tail" }] }] },
  drider: {
    routines: [
      { steps: [{ name: "Longsword", count: 3 }] },
      { label: "Longbow", steps: [{ name: "Longbow", count: 3 }] },
      { label: "Bite for a longsword attack", steps: [{ name: "Longsword", count: 2 }, bite()] },
      { label: "Bite for a longbow attack", steps: [{ name: "Longbow", count: 2 }, bite()] }
    ]
  },
  efreeti: { routines: [{ steps: [{ name: "Scimitar", count: 2 }] }, { label: "Hurl Flame", steps: [{ name: "Hurl Flame", count: 2 }] }] },
  glabrezu: {
    routines: [{ steps: [{ name: "Pincer", count: 2 }, { name: "Fist", count: 2 }] }],
    unsimulated: ["Alternatively, it makes two attacks with its pincers and casts one spell."]
  },
  grick: { routines: [{ steps: [{ name: "Tentacles" }, { name: "Beak", requiresPreviousHit: true, target: "same-as-previous" }] }] },
  "half-red-dragon-veteran": { routines: [{ steps: [{ name: "Longsword", count: 2 }, { name: "Shortsword" }] }] },
  "horned-devil": {
    routines: [{ steps: [{ name: "Fork", count: 2 }, { name: "Tail" }] }, { label: "Hurl Flame", steps: [{ name: "Hurl Flame", count: 3 }] }],
    unsimulated: ["It can also use Hurl Flame in place of just some of its melee attacks."]
  },
  hydra: { routines: [{ steps: [bite(5)] }], unsimulated: ["One bite per head: heads it loses or regrows don't change the count."] },
  kraken: { routines: [{ steps: [{ name: "Tentacle", count: 3 }] }], unsimulated: ["It can replace each tentacle attack with one use of Fling."] },
  lamia: { routines: [{ steps: [{ name: "Claws" }, { name: "Dagger" }] }], unsimulated: ["It can use its Intoxicating Touch in place of its dagger attack."] },
  lizardfolk: { routines: [{ steps: [{ any: "melee", count: 2 }] }], unsimulated: ["Each attack uses a different weapon."] },
  medusa: { routines: [{ steps: [{ name: "Snake Hair" }, { name: "Shortsword", count: 2 }] }, { label: "Longbow", steps: [{ name: "Longbow", count: 2 }] }] },
  merrow: { routines: [{ steps: [bite(), { name: "Claws" }] }, { label: "Harpoon", steps: [bite(), { name: "Harpoon (Melee)" }] }] },
  roper: { routines: [{ steps: [{ name: "Tendril", count: 4 }, bite()] }], unsimulated: ["It uses Reel between its tendril attacks and its bite."] },
  sahuagin: { routines: [{ steps: [bite(), { name: "Claws" }] }, { label: "Spear", steps: [bite(), { name: "Spear (Melee)" }] }] },
  "shambling-mound": {
    routines: [{ steps: [{ name: "Slam", count: 2 }] }],
    unsimulated: ["If both attacks hit a Medium or smaller target, the target is grappled (escape DC 14), and the shambling mound uses its Engulf on it."]
  },
  tarrasque: {
    routines: [
      { steps: [{ name: "Frightful Presence" }, bite(), { name: "Claw", count: 2 }, { name: "Horns" }, { name: "Tail" }] },
      { label: "Swallow", steps: [{ name: "Frightful Presence" }, { name: "Swallow" }, { name: "Claw", count: 2 }, { name: "Horns" }, { name: "Tail" }] }
    ]
  },
  "tyrannosaurus-rex": { routines: [{ steps: [bite(), { name: "Tail", target: "different" }] }] },
  veteran: { routines: [{ steps: [{ name: "Longsword", count: 2 }, { name: "Shortsword" }] }] },
  "violet-fungus": { routines: [{ steps: [{ name: "Rotting Touch", count: 3 }] }], unsimulated: ["The number of attacks is 1d4; the simulator always makes three."] },
  wight: {
    routines: [
      { steps: [{ name: "Longsword", count: 2 }] },
      { label: "Longbow", steps: [{ name: "Longbow", count: 2 }] },
      { label: "Life Drain", steps: [{ name: "Longsword" }, { name: "Life Drain" }] }
    ]
  },
  wyvern: { routines: [{ steps: [bite(), { name: "Stinger" }] }], unsimulated: ["While flying, it can use its claws in place of one other attack."] },
  xorn: { routines: [{ steps: [{ name: "Claw", count: 3 }, bite()] }] },
  // Lycanthropes: one routine per shape; each shape keeps the routines it has the attacks for.
  werebear: { routines: [{ steps: [{ name: "Greataxe", count: 2 }] }, { label: "Claws", steps: [{ name: "Claw", count: 2 }] }] },
  wereboar: { routines: [{ steps: [{ name: "Maul", count: 2 }] }, { label: "Tusks", steps: [{ name: "Maul" }, { name: "Tusks" }] }] },
  wererat: { routines: [{ steps: [{ name: "Shortsword", count: 2 }] }, { label: "Bite", steps: [{ name: "Shortsword" }, bite()] }] },
  weretiger: {
    routines: [
      { steps: [{ name: "Scimitar", count: 2 }] },
      { label: "Longbow", steps: [{ name: "Longbow", count: 2 }] },
      { label: "Claws", steps: [{ name: "Claw", count: 2 }] }
    ]
  },
  werewolf: { routines: [{ steps: [{ name: "Spear (Melee)", count: 2 }] }, { label: "Bite and claws", steps: [bite(), { name: "Claws" }] }] }
};

/** A table routine's steps, each named attack or ability found among the creature's own (exactly, then loosely). */
function stepsOf(spec: RoutineSpec, abilities: Own[], ctx: MonsterContext): MultiattackStep[] | undefined {
  const steps: MultiattackStep[] = [];
  for (const step of spec.steps) {
    const found = step.name
      ? abilities.find((action) => action.name.toLowerCase() === step.name!.toLowerCase()) ?? findOwn(step.name, abilities)
      : undefined;
    if (step.name && !found) {
      ctx.gaps.add("MULTIATTACK_PARSE", `Multiattack: "${step.name}" isn't one of this creature's attacks`);
      return undefined;
    }
    steps.push({
      ...(found ? { actionId: found.id } : { any: step.any! }),
      count: step.count ?? 1,
      ...(step.target ? { target: step.target } : {}),
      ...(step.requiresPreviousHit ? { requiresPreviousHit: true } : {})
    });
  }
  return steps;
}

/** A label for an option the parser found: the attacks it uses ("Longbow", "Pincer, Fist"), or its kind ("Ranged"). */
function labelOf(variant: Variant, own: Own[]): string {
  return [...new Set(variant.attacks.map((step) => (step.any
    ? `${step.any[0]!.toUpperCase()}${step.any.slice(1)}`
    : (own.find((action) => action.id === step.actionId)?.name ?? step.actionId!).replace(/\s*\(.*?\)\s*/g, " ").trim())))].join(", ");
}

/**
 * Compiles a `Multiattack` entry into one multiattack: its routine, and the routines it can use instead as options
 * ("…or it makes two ranged attacks"). Statblocks the parser can't read (replacements, attacks that follow a hit, target
 * rules) come from `ROUTINES`. What isn't simulated is reported, and listed on the routine so the sheet says so.
 */
export function parseMultiattack(entry: RawEntry, own: Own[], ctx: MonsterContext, saves: Array<{ id: string; name: string }> = []): ActionDefinition[] {
  const text = entry.desc.replace(/\s+/g, " ").trim();
  const build = (routines: MultiattackStep[][], labels: Array<string | undefined>, unsimulated: string[]): MultiattackActionDefinition[] => {
    const [main, ...options] = routines;
    return [{
      kind: "multiattack",
      id: uniqueId(ctx, "multiattack"),
      name: "Multiattack",
      actionType: "action",
      attacks: main!,
      ...(options.length ? { options: options.map((attacks, index) => ({ ...(labels[index + 1] ? { label: labels[index + 1] } : {}), attacks })) } : {}),
      ...(unsimulated.length ? { unsimulated } : {}),
      automationSupport: "full"
    }];
  };

  const spec = ROUTINES[ctx.slug];
  if (spec) {
    const abilities: Own[] = [...own, ...saves.map((save) => ({ ...save, attackType: "melee" as const }))];
    const routines = spec.routines.map((routine) => stepsOf(routine, abilities, ctx));
    if (routines.some((routine) => !routine)) return [];
    for (const sentence of spec.unsimulated ?? []) ctx.gaps.add("MULTIATTACK_STEP", `${entry.name}: ${sentence.slice(0, 90)}`);
    return build(routines as MultiattackStep[][], spec.routines.map((routine) => routine.label), spec.unsimulated ?? []);
  }

  // "The dragon can use its Frightful Presence. It then makes three attacks…": one of its own save actions goes first,
  // or last when the statblock uses it after its attacks ("makes one bite attack and, if it can, uses its Blinding Spittle").
  const usesAt = (save: { name: string }) => text.search(new RegExp(`\\buses?\\s+(?:its\\s+)?${save.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
  const prefix = saves.filter((save) => usesAt(save) >= 0);
  const firstAttack = text.search(/\bmakes?\b/i);
  // "…makes two longsword attacks or two longbow attacks" is two alternatives in one sentence.
  const alternative = new RegExp(`,?\\s+or\\s+(?=(?:it\\s+|the\\s+[a-z' -]+?\\s+)?(?:makes?\\s+)?${COUNT}\\s+[a-z' -]+?\\s+attacks?\\b)`, "i");
  const sentences = text.split(/(?<=[.!])\s+/).flatMap((sentence) => {
    const [first, ...rest] = sentence.split(alternative);
    return [first!, ...rest.map((piece) => (/\bmakes?\b/i.test(piece) ? piece : `It makes ${piece}`))];
  });
  const variants: Variant[] = [];
  const unsimulated: string[] = [];
  let unresolved: string | undefined;

  for (const sentence of sentences) {
    // "…and casts one spell": a routine with a spell in it is listed as not simulated, not run without the spell.
    const parsed = /\bcasts?\b|\bspells?\b/i.test(sentence) ? null : parseSentence(sentence, own, ctx, entry.name);
    if (!parsed) {
      if (prefix.some((save) => sentence.toLowerCase().includes(save.name.toLowerCase()))) continue;
      if (/frightful presence|can use|casts?\b|spell|replace|instead|in place of|drawn/i.test(sentence)) {
        ctx.gaps.add("MULTIATTACK_STEP", `${entry.name}: ${sentence.slice(0, 90)}`);
        unsimulated.push(sentence);
      }
      continue;
    }
    if ("unresolved" in parsed) {
      unresolved = parsed.unresolved;
      continue;
    }
    variants.push(...parsed);
  }

  if (variants.length === 0) {
    ctx.gaps.add("MULTIATTACK_PARSE", `${entry.name}: ${unresolved ?? "no attack sequence found"} — "${text.slice(0, 90)}"`);
    return [];
  }
  if (unresolved) {
    ctx.gaps.add("MULTIATTACK_PARSE", `${entry.name}: a variant used ${unresolved}, which isn't one of this creature's attacks`);
  }
  const after = (save: { name: string }) => firstAttack >= 0 && usesAt(save) > firstAttack;
  const opening: MultiattackStep[] = prefix.filter((save) => !after(save)).map((save) => ({ actionId: save.id, count: 1 }));
  const closing: MultiattackStep[] = prefix.filter(after).map((save) => ({ actionId: save.id, count: 1 }));
  return build(
    variants.map((variant) => [...opening, ...variant.attacks, ...closing]),
    variants.map((variant, index) => (index === 0 ? undefined : variant.label ?? labelOf(variant, own))),
    unsimulated
  );
}
