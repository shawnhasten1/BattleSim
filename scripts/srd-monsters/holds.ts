import type { ActionRider, DamageComponent, SizeCategory } from "../../src/engine/types";
import { compactDice, isDamageType } from "./util";

const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, ten: 10 };
const SIZES = "Tiny|Small|Medium|Large|Huge|Gargantuan";

/**
 * Reads a grapple off an attack's text: "the target is grappled (escape DC 16). Until this grapple ends, the
 * target is restrained, and the crocodile can't bite another target."
 * `full` is the whole action text — "one Large or smaller creature" sits in the attack's header, before the hit.
 * Returns null for anything that isn't a plain grapple-on-hit (the vampire's "instead of dealing damage" grapple,
 * a swallow, an engulf).
 */
export function parseHold(hit: string, full: string): Extract<ActionRider, { kind: "hold" }> | null {
  const dc = /grappled[^.]*?\(escape DC (\d+)\)|grapple the target \(escape DC (\d+)\)|\(escape DC (\d+)\)/i.exec(hit);
  const escapeDc = Number(dc?.[1] ?? dc?.[2] ?? dc?.[3]);
  if (!escapeDc || /instead of dealing damage/i.test(hit)) return null;

  const size = new RegExp(`\\b(${SIZES})(?: or smaller)? (?:creature|target)`, "i").exec(full)
    ?? new RegExp(`\\b(${SIZES}) or smaller\\b`, "i").exec(full);
  const maxSize = /or smaller/i.test(size?.[0] ?? "") || /^(?:if the target is|one|a)\b/i.test(size?.[0] ?? "") ? size?.[1]?.toLowerCase() as SizeCategory | undefined : undefined;

  const restrained = /\brestrained\b/i.test(hit);
  const claws = /has (two|three|four|ten) (?:claws|pincers|tentacles|tendrils|tails)[^.]*each of which can grapple/i.exec(hit)
    ?? /doesn't have (two|three) other creatures grappled/i.exec(hit);
  const limit = claws ? COUNT_WORDS[claws[1]!.toLowerCase()] : undefined;

  let recurringDamage: DamageComponent[] | undefined;
  const recurring = /takes (\d+) \(([^)]+)\) ([a-z]+) damage at the start of each of (?:its|the target's) turns/i.exec(hit)
    ?? /at the start of each of (?:its|the target's) turns, the target takes (\d+) \(([^)]+)\) ([a-z]+) damage/i.exec(hit);
  if (recurring && isDamageType(recurring[3]!.toLowerCase())) {
    recurringDamage = [{ dice: compactDice(recurring[2]!), damageType: recurring[3]!.toLowerCase() as DamageComponent["damageType"] }];
  }

  return {
    kind: "hold", when: "on-hit", escapeDc,
    ...(maxSize ? { maxSize } : {}),
    ...(restrained ? { restrained: true } : {}),
    ...(limit && limit > 1 ? { limit } : {}),
    ...(recurringDamage ? { recurringDamage } : {})
  };
}

/** Sentences that only restate a grapple the engine now handles — dropped so they don't become reference notes. */
export function withoutHoldSentences(text: string): string {
  return text
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/grappl|escape DC|restrained until|until this grapple ends|until the grapple ends|can't (?:bite|constrict|use its \w+|make \w+ attacks?) (?:against )?(?:another|other)|each of which can grapple|automatically hit the target|has (?:two|ten) (?:claws|pincers|tentacles|tendrils|tails)/i.test(sentence))
    .join(" ")
    .trim();
}

/**
 * Reads a swallow: "…the target is swallowed, and the grapple ends. While swallowed, the target is blinded and
 * restrained, it has total cover against attacks and other effects outside the behir, and it takes 21 (6d6) acid
 * damage at the start of each of the behir's turns. If the behir takes 30 damage or more on a single turn from a
 * creature inside it, the behir must succeed on a DC 14 Constitution saving throw at the end of that turn or
 * regurgitate all swallowed creatures…"
 */
export function parseSwallow(text: string, full: string): Extract<ActionRider, { kind: "swallow" }> | null {
  if (!/swallowed/i.test(text)) return null;
  const size = new RegExp(`\\b(${SIZES}) or smaller\\b`, "i").exec(full);
  const save = /must succeed on a DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw or be swallowed/i.exec(text);
  const damage = /takes (\d+) \(([^)]+)\) ([a-z]+) damage at the start of each of/i.exec(text);
  const regurgitate = /takes (\d+) damage or more on a single turn from a creature inside[\s\S]*?DC (\d+) Constitution/i.exec(text);
  const abilities: Record<string, "str" | "dex" | "con" | "int" | "wis" | "cha"> = {
    strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha"
  };
  return {
    kind: "swallow", when: "on-hit",
    ...(size ? { maxSize: size[1]!.toLowerCase() as SizeCategory } : {}),
    ...(/grappl(?:ing|ed by)/i.test(text) ? { requiresHeld: true } : {}),
    ...(save ? { save: { ability: abilities[save[2]!.toLowerCase()]!, dc: Number(save[1]) } } : {}),
    ...(damage && isDamageType(damage[3]!.toLowerCase())
      ? { damage: [{ dice: compactDice(damage[2]!), damageType: damage[3]!.toLowerCase() as DamageComponent["damageType"] }] }
      : {}),
    ...(regurgitate ? { regurgitate: { damage: Number(regurgitate[1]), dc: Number(regurgitate[2]) } } : {})
  };
}

/** Sentences that only restate a swallow the engine now handles. */
export function withoutSwallowSentences(text: string): string {
  return text
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/swallow|blinded and restrained|total cover|at the start of each of the \w+'s turns|regurgitate|damage or more on a single turn|no longer restrained|escape from the corpse/i.test(sentence))
    .join(" ")
    .trim();
}
