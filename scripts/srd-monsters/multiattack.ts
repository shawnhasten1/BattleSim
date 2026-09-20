import type { ActionDefinition, AttackActionDefinition, MultiattackActionDefinition } from "../../src/engine/types";
import type { MonsterContext, RawEntry } from "./context";
import { uniqueId } from "./context";
import { averageDice, slugify } from "./util";

const slugifyLabel = slugify;

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

interface Variant {
  attacks: Array<{ actionId: string; count: number }>;
  text: string;
}

/** Own attacks that stand on their own (the "(Two-Handed)" copies are alternatives of the same weapon). */
function primaryAttacks(own: Own[]): Own[] {
  return own.filter((action) => !/-two-handed$/.test(action.id));
}

/** Parses one sentence into one or more variants, or reports why it couldn't. */
function parseSentence(sentence: string, own: Own[], ctx: MonsterContext, note: string): Variant[] | { unresolved: string } | null {
  const lower = sentence.toLowerCase();
  if (!/\bmakes?\b/.test(lower) || !/attack/.test(lower)) return null;

  const attacks: Array<{ actionId: string; count: number }> = [];
  const colon = /attacks?:\s*(.*)$/i.exec(sentence);
  if (colon) {
    const item = new RegExp(`${COUNT}\\s+(?:melee\\s+|ranged\\s+)?(?:attacks?\\s+)?with\\s+${POSSESSIVE}\\s+([a-z' -]+?)(?=,|\\s+and\\b|\\.|$|\\s+or\\b)`, "gi");
    // "two with its spear (humanoid form) or one with its bite and one with its claws (hybrid form)":
    // form notes are noise, and "or" separates alternatives, each its own variant.
    const alternatives: Variant[] = [];
    for (const option of colon[1]!.replace(/\([^)]*\)/g, "").split(/\s+or\s+(?=(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d*d\d+)\s+(?:melee\s+|ranged\s+)?(?:attacks?\s+)?with\b)/i)) {
      const steps: Array<{ actionId: string; count: number }> = [];
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

  // "…makes three attacks, either with its longsword or its longbow" → one variant per named weapon.
  const either = new RegExp(`(?:either|with either)\\s+(?:with\\s+)?${POSSESSIVE}\\s+([a-z' -]+?)\\s+or\\s+${POSSESSIVE}\\s+([a-z' -]+?)(?=[.,]|$)`, "i").exec(sentence);
  if (either) {
    const found = [either[1]!, either[2]!].map((word) => findOwn(word, own));
    if (found.some((action) => !action)) return { unresolved: `"${either[1]}" or "${either[2]}"` };
    return found.map((action) => ({ attacks: [{ actionId: action!.id, count }], text: sentence }));
  }

  // "…makes two attacks, only one of which can be a bite" → all of the plain attack, or one of it plus the bite.
  const only = /only one of which can be (?:a |an |with its |with )?([a-z' -]+?)(?=[.,]|$|\s+attack)/i.exec(sentence);
  if (only) {
    const limited = findOwn(only[1]!, own);
    const plain = primaryAttacks(own).filter((action) => action.id !== limited?.id && action.attackType === "melee");
    if (!limited || plain.length === 0) return { unresolved: `"only one of which can be ${only[1]}"` };
    return [
      { attacks: [{ actionId: plain[0]!.id, count }], text: sentence },
      { attacks: [{ actionId: plain[0]!.id, count: count - 1 }, { actionId: limited.id, count: 1 }].filter((step) => step.count > 0), text: sentence }
    ];
  }

  // Bare "makes three attacks": any of its attacks, so offer each plain attack as its own variant.
  const kind = countMatch[2]?.toLowerCase();
  const candidates = primaryAttacks(own).filter((action) => kind === "ranged" ? action.attackType === "ranged" : kind === "melee" || kind === "weapon" ? action.attackType === "melee" : true);
  if (candidates.length === 0) return { unresolved: `"${countMatch[0]}" with no matching attacks` };
  if (candidates.length > 4) return { unresolved: `generic "${countMatch[0]}" with ${candidates.length} candidate attacks` };
  return candidates.map((action) => ({ attacks: [{ actionId: action.id, count }], text: sentence }));
}

/**
 * Compiles a `Multiattack` entry into one multiattack action per alternative
 * ("…or it makes two ranged attacks" is a second variant the AI can choose).
 * Anything that isn't a plain sequence of the creature's own attacks —
 * "can use its Frightful Presence", "casts a spell" — is reported, not guessed.
 */
export function parseMultiattack(entry: RawEntry, own: Own[], ctx: MonsterContext, saves: Array<{ id: string; name: string }> = []): ActionDefinition[] {
  const text = entry.desc.replace(/\s+/g, " ").trim();
  // "The dragon can use its Frightful Presence. It then makes three attacks…": one of its own save actions goes first.
  const prefix = saves.filter((save) => new RegExp(`\\buses?\\s+(?:its\\s+)?${save.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(text));
  // "…makes two longsword attacks or two longbow attacks" is two alternatives in one sentence.
  const alternative = new RegExp(`,?\\s+or\\s+(?=(?:it\\s+|the\\s+[a-z' -]+?\\s+)?(?:makes?\\s+)?${COUNT}\\s+[a-z' -]+?\\s+attacks?\\b)`, "i");
  const sentences = text.split(/(?<=[.!])\s+/).flatMap((sentence) => {
    const [first, ...rest] = sentence.split(alternative);
    return [first!, ...rest.map((piece) => (/\bmakes?\b/i.test(piece) ? piece : `It makes ${piece}`))];
  });
  const variants: Variant[] = [];
  let unresolved: string | undefined;

  for (const sentence of sentences) {
    const parsed = parseSentence(sentence, own, ctx, entry.name);
    if (!parsed) {
      if (prefix.some((save) => sentence.toLowerCase().includes(save.name.toLowerCase()))) continue;
      if (/frightful presence|can use|casts?\b|spell|replace|instead|in place of|drawn/i.test(sentence)) {
        ctx.gaps.add("MULTIATTACK_STEP", `${entry.name}: ${sentence.slice(0, 90)}`);
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

  // Existing actors name alternatives after their weapons: "Multiattack (Longsword)", "Multiattack (Longbow)".
  const label = (variant: Variant): string => [...new Set(variant.attacks.map((step) =>
    (own.find((action) => action.id === step.actionId)?.name ?? step.actionId).replace(/\s*\(.*?\)\s*/g, " ").trim()
  ))].join(", ");
  const labels = variants.map(label);
  return variants.map((variant, index): MultiattackActionDefinition => ({
    kind: "multiattack",
    id: uniqueId(ctx, variants.length === 1 ? "multiattack" : `multiattack-${slugifyLabel(labels[index]!)}`),
    name: variants.length === 1 ? "Multiattack" : `Multiattack (${labels[index]})`,
    actionType: "action",
    attacks: [...prefix.map((save) => ({ actionId: save.id, count: 1 })), ...variant.attacks],
    automationSupport: "full"
  }));
}
