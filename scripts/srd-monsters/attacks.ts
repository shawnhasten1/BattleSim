import type {
  Ability, ActionDefinition, ActionRider, AttackActionDefinition, DamageComponent, FeatureDefinition
} from "../../src/engine/types";
import { type MonsterContext, type RawEntry, uniqueId } from "./context";
import { buildConditionRider, findConditionOnFail, findSaveClause, findSaveDamage } from "./riders";
import { parseHold, parseSwallow, withoutHoldSentences, withoutSwallowSentences } from "./holds";
import { applyUsage } from "./usage";
import { ABILITIES, abilityMod, compactDice, describesMagicalEffect, isDamageType, slugify } from "./util";

export const ATTACK_HEAD =
  /^(Melee or Ranged|Melee|Ranged)\s+(Weapon|Spell)\s+Attack:\s*([+-]\d+)\s+to hit(?:\s*\([^)]*\))?,\s*([\s\S]*?)\s*Hit:\s*([\s\S]*)$/;

export interface AttackParseResult {
  actions: ActionDefinition[];
  /** Generated features that carry the attack's save-for-damage effect. */
  features: FeatureDefinition[];
}

/** Edge-case sentences that follow a poison bite etc. and don't change a combat sim. */
const IGNORABLE = [
  /^If the poison damage reduces the target to 0 hit points, the target is stable but poisoned for 1 hour[^.]*\.?$/i
];

function damageComponent(match: RegExpExecArray | RegExpMatchArray, magical: boolean): DamageComponent | null {
  const type = match[3]!.toLowerCase();
  if (!isDamageType(type)) return null;
  const component: DamageComponent = { dice: compactDice(match[2] ?? match[1]!), damageType: type };
  const alt = match[4]?.toLowerCase();
  if (alt && isDamageType(alt)) component.damageTypeOptions = [type, alt];
  if (magical) component.magical = true;
  return component;
}

const FIRST_DAMAGE = /^\s*(\d+)(?:\s*\(([^)]+)\))?\s+([a-z]+)(?:\s+or\s+([a-z]+))?\s+damage/i;
const PLUS_DAMAGE = /^\s*,?\s*plus\s+(\d+)(?:\s*\(([^)]+)\))?\s+([a-z]+)(?:\s+or\s+([a-z]+))?\s+damage/i;
const VERSATILE = /^\s*,\s*or\s+(\d+)(?:\s*\(([^)]+)\))?\s+([a-z]+)\s+damage if (?:used|wielded) with two hands(?: to make a melee attack)?/i;
const SWARM_HALF = /^\s*,\s*or\s+(\d+)(?:\s*\(([^)]+)\))?\s+([a-z]+)\s+damage if the swarm has half of its hit points or fewer/i;

interface LeadingDamage {
  damage: DamageComponent[];
  versatile?: DamageComponent[];
  swarmHalf: boolean;
  /** The swarm's damage at half its hit points or fewer ("…, or 5 (2d4) piercing damage if the swarm has half…"). */
  swarmHalfDamage?: DamageComponent[];
  tail: string;
}

function parseLeadingDamage(hit: string, magical: boolean): LeadingDamage | null {
  let rest = hit;
  const first = FIRST_DAMAGE.exec(rest);
  if (!first) return null;
  const primary = damageComponent(first, magical);
  if (!primary) return null;
  rest = rest.slice(first[0].length);
  const damage = [primary];
  let versatile: DamageComponent[] | undefined;
  let swarmHalf = false;
  let swarmHalfDamage: DamageComponent[] | undefined;

  const versatileMatch = VERSATILE.exec(rest);
  if (versatileMatch) {
    const component = damageComponent(versatileMatch, magical);
    if (component) versatile = [component];
    rest = rest.slice(versatileMatch[0].length);
  } else {
    const swarm = SWARM_HALF.exec(rest);
    if (swarm) {
      swarmHalf = true;
      const component = damageComponent(swarm, magical);
      if (component) swarmHalfDamage = [component];
      rest = rest.slice(swarm[0].length);
    }
  }

  for (;;) {
    const plus = PLUS_DAMAGE.exec(rest);
    if (!plus) break;
    const component = damageComponent(plus, magical);
    if (!component) break;
    damage.push(component);
    versatile?.push({ ...component });
    rest = rest.slice(plus[0].length);
  }
  return { damage, versatile, swarmHalf, swarmHalfDamage, tail: rest.trim() };
}

function inferAbility(kind: "melee" | "ranged" | "spell", bonus: number, ctx: MonsterContext): Ability {
  const wanted = bonus - ctx.proficiencyBonus;
  const order: Ability[] = kind === "spell"
    ? ["int", "wis", "cha"]
    : kind === "ranged" ? ["dex", "str"] : ["str", "dex"];
  const preferred = order.find((ability) => abilityMod(ctx.abilities[ability]) === wanted);
  if (preferred) return preferred;
  const anyMatch = ABILITIES.find((ability) => abilityMod(ctx.abilities[ability]) === wanted);
  return anyMatch ?? order[0]!;
}

interface TailResult {
  riders: ActionRider[];
  features: FeatureDefinition[];
}

/** Compile the text after the leading damage into riders / a save-damage feature, reporting what can't be. */
function parseTail(tailInput: string, action: AttackActionDefinition, entry: RawEntry, ctx: MonsterContext): TailResult {
  const riders: ActionRider[] = [];
  const features: FeatureDefinition[] = [];
  // Drop sentences that are recognized-and-negligible before reading anything into the rest.
  let tail = tailInput
    .replace(/^[,.\s]+/, "")
    .replace(/\s+/g, " ")
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !IGNORABLE.some((pattern) => pattern.test(sentence.trim())))
    .join(" ")
    .trim();
  if (!tail) return { riders, features };

  // Text we can't automate goes on a reference-only trait, NEVER a `note` rider: the engine treats any
  // note rider as "needs a human" and demotes the whole attack, so the AI would stop using it.
  const notes: string[] = [];
  const note = (text: string, code: "RIDER_TEXT" | "HOLD_GRAPPLE" | "HOLD_SWALLOW") => {
    notes.push(text);
    ctx.gaps.add(code, `${entry.name}: ${text.slice(0, 80)}`);
  };
  const finish = (): TailResult => {
    if (notes.length > 0) {
      features.push({
        id: `${action.id}-not-automated`,
        name: `${action.name} (not automated)`,
        category: "trait",
        automationSupport: "manual-only",
        description: notes.join(" ")
      });
    }
    return { riders, features };
  };

  // A swallow inside an attack (the kraken's and purple worm's bites) is a `swallow` rider.
  const swallow = /engulf/i.test(tail) ? null : parseSwallow(tail, entry.desc);
  if (swallow) {
    riders.push(swallow);
    tail = withoutSwallowSentences(tail);
    if (!tail) return finish();
  }

  // A grapple is a real `hold` rider; whatever else the text says is handled below.
  const hold = /swallow|engulf/i.test(tail) ? null : parseHold(tail, entry.desc);
  if (hold) {
    riders.push(hold);
    tail = withoutHoldSentences(tail);
    if (!tail) return finish();
  }

  // Swallows are not automated yet — keep them as reference notes.
  if (/swallow/i.test(tail)) {
    note(tail, "HOLD_SWALLOW");
    return finish();
  }
  if (/\b(grappled|grapple|restrained until|attaches to|escape DC)\b/i.test(tail)) {
    const save = findSaveClause(tail);
    note(tail, "HOLD_GRAPPLE");
    if (!save) return finish();
  }

  const save = findSaveClause(tail);
  if (!save) {
    const remaining = IGNORABLE.some((pattern) => pattern.test(tail)) ? "" : tail;
    if (remaining && !riders.length) note(remaining, "RIDER_TEXT");
    return finish();
  }

  const condition = findConditionOnFail(tail);
  const saveDamage = findSaveDamage(tail);
  let handled = false;

  if (saveDamage) {
    features.push({
      id: `${action.id}-save-damage`,
      name: `${action.name} (save effect)`,
      category: "trait",
      automationSupport: "full",
      description: tail,
      effects: [{
        kind: "save-gated-damage",
        actionIds: [action.id],
        damage: saveDamage.damage,
        save: { ability: save.ability, dc: save.dc, halfDamageOnSuccess: saveDamage.half }
      }]
    });
    handled = true;
  }
  if (condition) {
    riders.push(buildConditionRider(condition, "on-hit", save));
    handled = true;
  }
  if (!handled) {
    note(tail, "RIDER_TEXT");
  } else {
    // Sentences beyond the save clause that change the sim (max-HP drain, curse, disease, lycanthropy, push).
    const extra = tail
      .split(/(?<=\.)\s+/)
      .filter((sentence) => !/DC\s+\d+/.test(sentence) && !IGNORABLE.some((pattern) => pattern.test(sentence.trim())))
      .filter((sentence) => /hit point maximum|curse|disease|lycanthropy|pushed|regains|stable/i.test(sentence));
    if (extra.length > 0) note(extra.join(" "), "RIDER_TEXT");
  }
  return finish();
}

/**
 * Statblock damage reads "15 (3d6 + 5)". Actors in this app store the dice and the wielding
 * ability separately (`3d6` + `abilityModifier: "str"`), so editing STR changes the damage. When the flat
 * part equals that ability's modifier (or exceeds it by a small magic bonus) store it that way; otherwise
 * keep the exact dice. Only the primary component is linked — "plus 2d6 fire" has no modifier.
 */
function linkAbilityDamage(damage: DamageComponent[], attackAbility: Ability, ctx: MonsterContext): DamageComponent[] {
  const copies = damage.map((component) => ({ ...component }));
  const primary = copies[0];
  if (!primary) return copies;
  const match = /^(\d*d\d+)([+-]\d+)?$/.exec(primary.dice);
  if (!match) return copies;
  const flat = match[2] ? Number(match[2]) : 0;

  const candidates: Ability[] = [attackAbility, ...(["str", "dex"] as Ability[]).filter((ability) => ability !== attackAbility)];
  let ability = candidates.find((candidate) => abilityMod(ctx.abilities[candidate]) === flat);
  let residual = 0;
  if (!ability) {
    const surplus = flat - abilityMod(ctx.abilities[attackAbility]);
    if (surplus > 0 && surplus <= 3) {
      ability = attackAbility;
      residual = surplus;
    }
  }
  if (!ability) return copies;
  primary.dice = residual > 0 ? `${match[1]}+${residual}` : match[1]!;
  primary.abilityModifier = ability;
  return copies;
}

/** Parses one `Melee/Ranged Weapon/Spell Attack` line into one or more attack actions. */
export function parseAttack(entry: RawEntry, ctx: MonsterContext): AttackParseResult | null {
  const head = ATTACK_HEAD.exec(entry.desc.trim());
  if (!head) return null;
  const [, shape, kindWord, bonusText, middle, hit] = head as unknown as [string, string, string, string, string, string];
  const attackBonus = Number(bonusText);
  const isSpell = kindWord === "Spell";
  const magical = isSpell;

  let leading = parseLeadingDamage(hit, magical);
  if (!leading) {
    // "Hit: The target must make a DC 15 Constitution saving throw, taking 45 (10d8) poison damage…" —
    // all of the damage is save-gated, so the attack itself carries none.
    const saveOnly = findSaveClause(hit) !== null && findSaveDamage(hit) !== null && /^The target must/i.test(hit.trim());
    // "Hit: The target is grappled (escape DC 15)": no damage, just the grip.
    const holdOnly = !saveOnly && !/swallow/i.test(hit) && !/\bdamage\b/i.test(hit) && parseHold(hit, entry.desc) !== null;
    if (holdOnly) {
      leading = { damage: [], swarmHalf: false, tail: hit };
    } else if (!saveOnly) {
      // A hold we can't read, or a swallow — not automated yet.
      if (/grappled|restrained|escape DC|swallow/i.test(hit)) {
        ctx.gaps.add(/swallow/i.test(hit) ? "HOLD_SWALLOW" : "HOLD_GRAPPLE", entry.name);
      } else {
        ctx.gaps.add("ATTACK_UNPARSED", entry.name);
      }
      return null;
    } else {
      leading = { damage: [], swarmHalf: false, tail: hit };
    }
  }

  const reachMatch = /reach\s+(\d+)\s*(?:ft|feet)/i.exec(middle);
  // "reach 0 ft., one creature in the swarm's space": the engine has no shared squares, so a swarm attacks
  // from an adjacent square instead (same reach in practice).
  if (reachMatch && Number(reachMatch[1]) === 0) {
    reachMatch[1] = "5";
  }
  const rangeMatch = /range\s+(\d+)(?:\/(\d+))?\s*(?:ft|feet)/i.exec(middle);
  const variants: Array<{ suffix: string; kind: "melee" | "ranged" | "spell"; range: number; reach?: number; longRange?: number }> = [];
  const wantsMelee = shape !== "Ranged";
  const wantsRanged = shape !== "Melee";
  if (isSpell) {
    const distance = rangeMatch ? Number(rangeMatch[1]) : reachMatch ? Number(reachMatch[1]) : 5;
    variants.push({ suffix: "", kind: "spell", range: distance, reach: reachMatch ? Number(reachMatch[1]) : undefined, longRange: rangeMatch?.[2] ? Number(rangeMatch[2]) : undefined });
  } else {
    if (wantsMelee && reachMatch) variants.push({ suffix: shape === "Melee or Ranged" ? "Melee" : "", kind: "melee", range: Number(reachMatch[1]), reach: Number(reachMatch[1]) });
    if (wantsRanged && rangeMatch) variants.push({ suffix: shape === "Melee or Ranged" ? "Ranged" : "", kind: "ranged", range: Number(rangeMatch[1]), longRange: rangeMatch[2] ? Number(rangeMatch[2]) : undefined });
    if (variants.length === 0) return null;
  }

  const actions: ActionDefinition[] = [];
  const features: FeatureDefinition[] = [];
  const baseSlug = slugify(entry.name);

  for (const variant of variants) {
    const label = variant.suffix ? `${entry.name} (${variant.suffix})` : entry.name;
    const id = uniqueId(ctx, variant.suffix ? `${baseSlug}-${variant.suffix.toLowerCase()}` : baseSlug);
    const ability = inferAbility(variant.kind, attackBonus, ctx);
    const build = (damage: DamageComponent[], name: string, actionId: string): AttackActionDefinition => ({
      kind: "attack",
      id: actionId,
      name,
      actionType: "action",
      attackType: variant.kind,
      ability,
      attackBonus,
      range: variant.range,
      ...(variant.longRange ? { longRange: variant.longRange } : {}),
      ...(variant.reach !== undefined ? { reach: variant.reach } : {}),
      // Spell attacks don't add an ability modifier to damage; everything else follows the actor convention.
      damage: variant.kind === "spell" ? damage.map((component) => ({ ...component })) : linkAbilityDamage(damage, ability, ctx),
      // "…saving throw against being magically petrified": the rider's save is against a magical effect.
      ...(!isSpell && describesMagicalEffect(hit) ? { magical: true } : {}),
      automationSupport: "full"
    });

    const action = build(leading.damage, label, id);
    const tail = parseTail(leading.tail, action, entry, ctx);
    if (tail.riders.length > 0) action.riders = tail.riders;
    features.push(...tail.features);
    applyUsage(action, entry, ctx);
    if (leading.swarmHalfDamage) action.bloodiedDamage = variant.kind === "spell" ? leading.swarmHalfDamage.map((component) => ({ ...component })) : linkAbilityDamage(leading.swarmHalfDamage, ability, ctx);
    else if (leading.swarmHalf) ctx.gaps.add("SWARM_DAMAGE", entry.name);
    actions.push(action);

    if (leading.versatile) {
      const twoHandedId = uniqueId(ctx, `${id}-two-handed`);
      const twoHanded = build(leading.versatile, `${label} (Two-Handed)`, twoHandedId);
      if (tail.riders.length > 0) twoHanded.riders = tail.riders.map((rider) => ({ ...rider }));
      // The generated save-damage feature is scoped to one action id; extend it to the variant.
      for (const feature of tail.features) {
        for (const effect of feature.effects ?? []) {
          if (effect.kind === "save-gated-damage" && effect.actionIds) effect.actionIds.push(twoHandedId);
        }
      }
      actions.push(twoHanded);
    }
  }
  return { actions, features };
}
