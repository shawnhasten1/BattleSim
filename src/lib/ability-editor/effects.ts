/**
 * Every kind of feature effect the editor offers (plan §3.4's While active cards), in one place: what it's called,
 * which theme it sits under in the Add menu, what a new one starts as, and which shared settings it takes ("When" from
 * `FeatureEffectConditions`, "Which attacks" from `FeatureEffectScope`). The cards, the Add menu and the tests read it.
 */
import type { Ability, ConditionInstance, DamageAdjustment, FeatureCondition, FeatureEffect, NumericFormula } from "@/engine";

export type EffectKind = FeatureEffect["kind"];
export type EffectTheme = "attacks" | "defense" | "saves" | "survival" | "turn";

export interface EffectKindSpec {
  kind: EffectKind;
  /** The card's name and the Add menu's entry. */
  label: string;
  /** One line under it in the Add menu. */
  hint: string;
  theme: EffectTheme;
  /**
   * It takes "When". An attack's effects can ask about the attack and the target (advantage, an ally beside it, a
   * charge); the rest are checked on the creature alone, where only "it's bloodied" means anything to the engine.
   */
  when: false | "attack" | "self";
  /** It takes "Which attacks": melee, ranged or spell, an ability, specific attacks. */
  scope: boolean;
  /** The engine reads it only from a condition (an activation), never from a trait that's always on. */
  conditionOnly?: boolean;
  blank: () => FeatureEffect;
}

export const THEMES: Array<{ theme: EffectTheme; label: string }> = [
  { theme: "attacks", label: "Its attacks" },
  { theme: "defense", label: "Its defense" },
  { theme: "saves", label: "Saving throws" },
  { theme: "survival", label: "Staying alive" },
  { theme: "turn", label: "Its turn" }
];

export const EFFECT_KINDS: EffectKindSpec[] = [
  // Its attacks
  {
    kind: "attack-advantage", label: "Advantage on its attacks", hint: "Or disadvantage: Pack Tactics, Reckless Attack", theme: "attacks", when: "attack", scope: true,
    blank: () => ({ kind: "attack-advantage", condition: "always" })
  },
  {
    kind: "attack-bonus", label: "Bonus to hit", hint: "A flat bonus or an ability modifier on its attack rolls", theme: "attacks", when: "attack", scope: true,
    blank: () => ({ kind: "attack-bonus", condition: "always", bonus: { base: 1 } })
  },
  {
    kind: "healing-bonus", label: "Bigger healing", hint: "Disciple of Life, Blessed Healer, Supreme Healing", theme: "survival", when: false, scope: false,
    blank: () => ({ kind: "healing-bonus", slotBonus: true })
  },
  {
    kind: "free-move", label: "A move with something else", hint: "Instinctive Pounce with Rage, Tactical Shift with Second Wind, a move after a critical hit", theme: "turn", when: false, scope: false,
    blank: () => ({ kind: "free-move", on: "critical-hit" })
  },
  {
    kind: "initiative", label: "Initiative", hint: "Advantage on the roll (Feral Instinct) or a bonus to it (Alert)", theme: "turn", when: false, scope: false,
    blank: () => ({ kind: "initiative", advantage: true })
  },
  {
    kind: "critical-range", label: "Critical hits on a lower roll", hint: "Improved Critical: a 19 or 20; Superior Critical: 18 to 20", theme: "attacks", when: "attack", scope: true,
    blank: () => ({ kind: "critical-range", condition: "always", minimum: 19 })
  },
  {
    kind: "spell-damage-ability", label: "An ability on spell damage", hint: "Potent Spellcasting, Empowered Evocation: its modifier on one damage roll of some spells", theme: "attacks", when: false, scope: false,
    blank: () => ({ kind: "spell-damage-ability", ability: "wis", cantripsOnly: true })
  },
  {
    kind: "spell-half-on-miss", label: "Half damage when a spell misses", hint: "Potent Cantrip: half on a miss or a made save, and nothing else", theme: "attacks", when: false, scope: false,
    blank: () => ({ kind: "spell-half-on-miss", cantripsOnly: true })
  },
  {
    kind: "spare-allies", label: "Allies spared by its area spells", hint: "Sculpt Spells: 1 + the spell's level of its allies succeed and take no damage", theme: "attacks", when: false, scope: false,
    blank: () => ({ kind: "spare-allies", base: 1, plusSpellLevel: true, spellSchools: ["evocation"] })
  },
  {
    kind: "metamagic", label: "A Metamagic option", hint: "Quickened, Twinned, Heightened…: a copy of each spell it changes, for sorcery points", theme: "attacks", when: false, scope: false,
    blank: () => ({ kind: "metamagic", option: "quickened", resourceCost: { resourceId: "sorcery-points", amount: 2 } })
  },
  {
    kind: "spell-range", label: "Longer spell range", hint: "Improved Elemental Fury: 300 ft more on a cantrip reaching 10 ft or more", theme: "attacks", when: false, scope: false,
    blank: () => ({ kind: "spell-range", bonus: 300, minRange: 10, cantripsOnly: true })
  },
  {
    kind: "on-hit-option", label: "An upgrade it can add to a hit", hint: "Eldritch Smite, Fire's Burn, Cunning Strike: a choice made on a hit, paid with a use or with Sneak Attack dice", theme: "attacks", when: false, scope: false,
    blank: () => ({ kind: "on-hit-option", option: { name: "Upgrade", riders: [] } })
  },
  {
    kind: "reaction-attack", label: "An attack back when hit", hint: "Retaliation: its reaction, one melee attack against the attacker", theme: "defense", when: false, scope: false,
    blank: () => ({ kind: "reaction-attack", trigger: { kind: "hit-by-attack", withinFt: 5, damaged: true }, attackTypes: ["melee"] })
  },
  {
    kind: "damage-dice", label: "Better damage dice", hint: "Great Weapon Fighting's 1s and 2s as 3s, Savage Attacker's second roll", theme: "attacks", when: "attack", scope: true,
    blank: () => ({ kind: "damage-dice", condition: "always", minimumDie: 3 })
  },
  {
    kind: "damage-bonus", label: "Extra damage on its hits", hint: "Sneak Attack, Rage's +2, Divine Fury", theme: "attacks", when: "attack", scope: true,
    blank: () => ({ kind: "damage-bonus", condition: "always", damage: [{ dice: "1d6", damageType: "same-as-attack" }] })
  },
  {
    kind: "save-gated-damage", label: "Damage on its hits, with a save", hint: "A poisonous bite: CON save or take more", theme: "attacks", when: "attack", scope: true,
    blank: () => ({ kind: "save-gated-damage", condition: "always", damage: [{ dice: "2d6", damageType: "poison" }], save: { ability: "con", dc: 11, halfDamageOnSuccess: true } })
  },
  {
    kind: "apply-condition-on-hit", label: "A condition on its hits", hint: "A charge that knocks prone, a grab that restrains", theme: "attacks", when: "attack", scope: true,
    blank: () => ({ kind: "apply-condition-on-hit", condition: "always", appliedCondition: { name: "prone" }, save: { ability: "str", dc: 13 } })
  },
  {
    kind: "swarm-damage", label: "Swarm damage", hint: "Its attacks weaken once it's down to half its hit points", theme: "attacks", when: false, scope: true,
    blank: () => ({ kind: "swarm-damage", fullHpDamage: [{ dice: "4d4", damageType: "piercing" }], bloodiedDamage: [{ dice: "2d4", damageType: "piercing" }] })
  },
  // Its defense
  {
    kind: "incoming-attack-modifier", label: "Attacks against it", hint: "Attackers have advantage or disadvantage", theme: "defense", when: "self", scope: false,
    blank: () => ({ kind: "incoming-attack-modifier", condition: "always", amount: -5 })
  },
  {
    kind: "armor-class-bonus", label: "AC bonus", hint: "A flat bonus or an ability modifier", theme: "defense", when: false, scope: false,
    blank: () => ({ kind: "armor-class-bonus", bonus: { base: 1 } })
  },
  {
    kind: "damage-adjustment", label: "Resistance, immunity or vulnerability", hint: "To one or more damage types, or absorbing them as healing", theme: "defense", when: "self", scope: false,
    blank: () => ({ kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType: "fire" } })
  },
  {
    kind: "condition-immunity", label: "Immune to a condition", hint: "Mindless Rage while raging; on an aura, its allies too (Aura of Courage)", theme: "defense", when: false, scope: false,
    blank: () => ({ kind: "condition-immunity", conditions: ["frightened"] })
  },
  {
    kind: "on-kill", label: "Temporary hit points on a kill", hint: "Dark One's Blessing: when it drops an enemy, or one drops near it", theme: "survival", when: false, scope: false,
    blank: () => ({ kind: "on-kill", tempHp: { base: 1 } })
  },
  {
    kind: "no-advantage-against", label: "No advantage against it", hint: "Elusive: attack rolls against it can't have advantage while it can act", theme: "defense", when: false, scope: false,
    blank: () => ({ kind: "no-advantage-against" })
  },
  {
    kind: "save-floor", label: "A save no lower than the score", hint: "Indomitable Might: a Strength save totalling less than the score uses the score", theme: "saves", when: false, scope: false,
    blank: () => ({ kind: "save-floor", ability: "str" })
  },
  {
    kind: "death-saves", label: "Better death saves", hint: "Defy Death: advantage, and 18–20 counting as a 20", theme: "survival", when: false, scope: false,
    blank: () => ({ kind: "death-saves", advantage: true })
  },
  {
    kind: "evasion", label: "Evasion", hint: "A DEX save for half takes none on a success", theme: "defense", when: false, scope: false,
    blank: () => ({ kind: "evasion" })
  },
  {
    kind: "no-critical-hits", label: "No critical hits against it", hint: "Adamantine armor: a critical hit becomes a normal hit", theme: "defense", when: false, scope: false,
    blank: () => ({ kind: "no-critical-hits" })
  },
  {
    kind: "unarmored-ac", label: "AC without armor", hint: "Unarmored Defense, Mage Armor: a base plus ability modifiers", theme: "defense", when: false, scope: false,
    blank: () => ({ kind: "unarmored-ac", base: 10, abilities: ["dex", "con"] })
  },
  {
    kind: "melee-retaliation", label: "Hurts what hits it in melee", hint: "Heated Body, a balor's Fire Aura", theme: "defense", when: false, scope: false,
    blank: () => ({ kind: "melee-retaliation", damage: [{ dice: "1d10", damageType: "fire" }], withinFt: 5 })
  },
  {
    kind: "incoming-hit-damage", label: "Hits against it deal more", hint: "A mark: the next hit on it deals extra damage", theme: "defense", when: "self", scope: false, conditionOnly: true,
    blank: () => ({ kind: "incoming-hit-damage", condition: "always", damage: [{ dice: "1d6", damageType: "same-as-attack" }] })
  },
  // Saving throws
  {
    kind: "d20-change", label: "Change a failed roll", hint: "Luck, Indomitable, Heroic Inspiration: reroll a failed save or a missed attack, add a die, make it a 20, or hit", theme: "saves", when: false, scope: false,
    blank: () => ({ kind: "d20-change", rolls: ["save"], change: "reroll" })
  },
  {
    kind: "save-bonus", label: "Bonus to its saves", hint: "All saves or one ability's", theme: "saves", when: false, scope: false,
    blank: () => ({ kind: "save-bonus", bonus: { base: 1 } })
  },
  {
    kind: "save-advantage", label: "Advantage on its saves", hint: "Magic Resistance, against being frightened…", theme: "saves", when: "self", scope: false,
    blank: () => ({ kind: "save-advantage" })
  },
  {
    kind: "save-dc-bonus", label: "Bonus to its save DCs", hint: "A spellcasting focus", theme: "saves", when: false, scope: false,
    blank: () => ({ kind: "save-dc-bonus", bonus: { base: 1 }, spellsOnly: true })
  },
  {
    kind: "auto-succeed-save", label: "Turns a failed save into a success", hint: "Legendary Resistance, from a pool of uses", theme: "saves", when: false, scope: false,
    blank: () => ({ kind: "auto-succeed-save", resourceId: "legendary-resistance" })
  },
  // Staying alive
  {
    kind: "hp-regen", label: "Regenerates", hint: "Regains hit points at the start of its turn", theme: "survival", when: false, scope: false,
    blank: () => ({ kind: "hp-regen", amount: 10 })
  },
  {
    kind: "survive-lethal", label: "Drops to 1 HP instead of 0", hint: "Undead Fortitude, Relentless", theme: "survival", when: false, scope: false,
    blank: () => ({ kind: "survive-lethal", save: { ability: "con", dcBase: 5 } })
  },
  {
    kind: "split-on-damage", label: "Splits when damaged", hint: "An ochre jelly hit by slashing or lightning", theme: "survival", when: false, scope: false,
    blank: () => ({ kind: "split-on-damage", triggerDamageTypes: ["slashing"], minHp: 10 })
  },
  // Its turn
  {
    kind: "extra-action", label: "An extra action", hint: "Action Surge: when it activates, another action this turn", theme: "turn", when: "self", scope: false,
    blank: () => ({ kind: "extra-action", slot: "action" })
  },
  {
    kind: "resource-regain", label: "Regains a resource", hint: "Points or charges back, each turn or when it activates", theme: "turn", when: false, scope: false,
    blank: () => ({ kind: "resource-regain", timing: "turn-start", resourceId: "", amount: { base: 1 } })
  },
  {
    kind: "avoids-opportunity-attacks", label: "Never provokes opportunity attacks", hint: "Mobile, a creature that moves freely", theme: "turn", when: "self", scope: false,
    blank: () => ({ kind: "avoids-opportunity-attacks", condition: "always" })
  }
];

export const EFFECT_SPECS = Object.fromEntries(EFFECT_KINDS.map((spec) => [spec.kind, spec])) as Record<EffectKind, EffectKindSpec>;

/** Effects that fire once, the moment a feature activates: the engine reads them from the feature, not its condition. */
export function firesOnActivate(effect: FeatureEffect): boolean {
  return effect.kind === "extra-action" || (effect.kind === "resource-regain" && effect.timing === "on-activate");
}

/* ─── "When" ─────────────────────────────────────────────────────────────── */

export const WHEN_CONDITIONS: Array<{ value: Exclude<FeatureCondition, "always">; label: string }> = [
  { value: "attack-has-advantage", label: "the attack has advantage" },
  { value: "ally-adjacent-to-target", label: "an ally is next to the target" },
  { value: "charged", label: "it charged the target" },
  { value: "self-bloodied", label: "it's bloodied" },
  { value: "target-bloodied", label: "the target is bloodied" },
  { value: "target-injured", label: "the target is hurt" },
  { value: "target-surprised", label: "the target is surprised" },
  { value: "target-grappled-by-self", label: "it's grappling the target" },
  { value: "attack-has-no-disadvantage", label: "the attack has no disadvantage" }
];

/** What an effect checked on the creature alone can ask: the engine reads only whether it's bloodied. */
export const SELF_WHEN_CONDITIONS: typeof WHEN_CONDITIONS = [{ value: "self-bloodied", label: "it's bloodied" }];

/** The conditions an effect needs, and whether all of them must hold or any one. Nothing listed means always. */
export interface WhenValue {
  conditions: Array<Exclude<FeatureCondition, "always">>;
  mode: "any" | "all";
  chargeFeet?: number;
}

type Gated = { condition?: FeatureCondition; allConditions?: FeatureCondition[]; anyConditions?: FeatureCondition[]; chargeFeet?: number };

/** An effect's "When", read from `condition`, `allConditions` and `anyConditions` however they're spelled. */
export function whenOf(effect: FeatureEffect): WhenValue {
  const gated = effect as Gated;
  const real = (list: FeatureCondition[] | undefined) => (list ?? []).filter((c): c is Exclude<FeatureCondition, "always"> => c !== "always");
  const main = real(gated.condition ? [gated.condition] : []);
  const any = real(gated.anyConditions);
  const all = real(gated.allConditions);
  if (any.length) return { conditions: [...new Set([...main, ...any])], mode: "any", chargeFeet: gated.chargeFeet };
  if (all.length) return { conditions: [...new Set([...main, ...all])], mode: "all", chargeFeet: gated.chargeFeet };
  // One condition or none: a second one picked means either will do (Sneak Attack), until the DM says all.
  return { conditions: main, mode: "any", chargeFeet: gated.chargeFeet };
}

/**
 * The effect with a new "When": one condition goes in `condition`; several go in `anyConditions` or `allConditions`
 * with `condition` "always" (which `attack-advantage` requires and the rest read as "no extra condition").
 */
export function withWhen<E extends FeatureEffect>(effect: E, when: WhenValue): E {
  const next = { ...effect } as E & Gated;
  delete next.allConditions;
  delete next.anyConditions;
  delete next.chargeFeet;
  const [only] = when.conditions;
  if (when.conditions.length <= 1) {
    next.condition = only ?? "always";
  } else {
    next.condition = "always";
    if (when.mode === "any") next.anyConditions = [...when.conditions];
    else next.allConditions = [...when.conditions];
  }
  // A charge distance only means something with "charged"; one that was spelled out (even the default 20) stays.
  if (when.conditions.includes("charged") && when.chargeFeet !== undefined) next.chargeFeet = when.chargeFeet;
  return next;
}

/* ─── resistances, folded into one card per kind ─────────────────────────── */

/** The cards a list of effects shows: resistances of one kind (and qualifiers) fold into a single card. */
export interface EffectCardView {
  effect: FeatureEffect;
  /** The places in the list it stands for (several for a folded resistance). */
  indices: number[];
  /** For a folded resistance: every damage type it covers. */
  damageTypes?: DamageAdjustment["damageType"][];
}

const adjustmentKey = (effect: Extract<FeatureEffect, { kind: "damage-adjustment" }>) => {
  const { type, nonMagicalOnly, exceptMaterials } = effect.adjustment;
  const when = whenOf(effect);
  return `${type}|${nonMagicalOnly ? 1 : 0}|${[...(exceptMaterials ?? [])].sort().join(",")}|${when.mode}:${when.conditions.join(",")}`;
};

/**
 * The cards for a list of effects. `apart` keeps the effects at those places a card of their own (the one just added,
 * while it's being edited), so a new resistance doesn't vanish into another before the DM has set it.
 */
export function effectCards(effects: FeatureEffect[], apart?: { from: number; count: number }): EffectCardView[] {
  const cards: EffectCardView[] = [];
  const folded = new Map<string, EffectCardView>();
  let own: EffectCardView | undefined;
  effects.forEach((effect, index) => {
    if (apart && index >= apart.from && index < apart.from + apart.count) {
      if (own && effect.kind === "damage-adjustment" && own.damageTypes) {
        own.indices.push(index);
        own.damageTypes.push(effect.adjustment.damageType);
        return;
      }
      own = { effect, indices: [index], ...(effect.kind === "damage-adjustment" ? { damageTypes: [effect.adjustment.damageType] } : {}) };
      cards.push(own);
      return;
    }
    if (effect.kind === "damage-adjustment") {
      const key = adjustmentKey(effect);
      const card = folded.get(key);
      if (card) {
        card.indices.push(index);
        card.damageTypes!.push(effect.adjustment.damageType);
        return;
      }
      const fresh: EffectCardView = { effect, indices: [index], damageTypes: [effect.adjustment.damageType] };
      folded.set(key, fresh);
      cards.push(fresh);
      return;
    }
    cards.push({ effect, indices: [index] });
  });
  return cards;
}

/** A folded resistance card back as one effect per damage type. */
export function expandCard(effect: FeatureEffect, damageTypes?: DamageAdjustment["damageType"][]): FeatureEffect[] {
  if (effect.kind !== "damage-adjustment") return [effect];
  const types = damageTypes?.length ? damageTypes : [effect.adjustment.damageType];
  return types.map((damageType) => ({ ...effect, adjustment: { ...effect.adjustment, damageType } }));
}

/**
 * The list with one card replaced (or removed, with `next` undefined): the card's effects go where its first one was,
 * everything else keeps its place.
 */
export function withCardReplaced(effects: FeatureEffect[], card: EffectCardView, next: FeatureEffect[] | undefined): FeatureEffect[] {
  const first = Math.min(...card.indices);
  const out: FeatureEffect[] = [];
  effects.forEach((effect, index) => {
    if (index === first && next) out.push(...next);
    if (!card.indices.includes(index)) out.push(effect);
  });
  return out;
}

/** Condition modifiers an activation can grant directly (Reckless Attack's attackers-get-advantage). */
export type ConditionModifiers = NonNullable<ConditionInstance["modifiers"]>;

/* ─── a condition's modifiers, as cards beside its effects ───────────────── */

/**
 * One of a condition's modifiers (Shield's +5 AC, Reckless Attack's attackers-have-advantage) as a card. Most read as
 * the effect that says the same and edit with that kind's fields, kept to what a modifier can hold (a number, no
 * "When"). Saving throws are a card per bonus, with the saves it covers; what has no effect to match (speed, actions
 * it can't take) is shown, and can be removed, but not edited.
 */
export interface ModifierCardView {
  key: keyof ConditionModifiers;
  /** The effect that says the same, for its sentence and fields. */
  effect?: FeatureEffect;
  /** Saving throws: the abilities that share this bonus. */
  abilities?: Ability[];
  /** Resistances and the like: every damage type the card covers. */
  damageTypes?: DamageAdjustment["damageType"][];
}

const ALL_ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const READ_ONLY_MODIFIERS = [
  "movementMultiplier", "speedPenaltyFt", "deniesActions", "deniesBonusActions", "deniesReactions", "deniesOpportunityAttacks", "oneThingPerTurn",
  "forcesRandomAction"
] as const;

export function modifierCards(modifiers: ConditionModifiers | undefined): ModifierCardView[] {
  if (!modifiers) return [];
  const cards: ModifierCardView[] = [];
  if (modifiers.armorClass) cards.push({ key: "armorClass", effect: { kind: "armor-class-bonus", bonus: { base: modifiers.armorClass } } });
  if (modifiers.attackRoll) cards.push({ key: "attackRoll", effect: { kind: "attack-bonus", condition: "always", bonus: { base: modifiers.attackRoll } } });
  if (modifiers.incomingAttackRoll) cards.push({ key: "incomingAttackRoll", effect: { kind: "incoming-attack-modifier", condition: "always", amount: modifiers.incomingAttackRoll } });
  // A card per bonus: Bless-style +2 to every save is one card; +2 WIS and +1 CON are two.
  const byValue = new Map<number, Ability[]>();
  for (const ability of ALL_ABILITIES) {
    const value = modifiers.savingThrows?.[ability];
    if (value) byValue.set(value, [...(byValue.get(value) ?? []), ability]);
  }
  for (const [value, abilities] of byValue) {
    cards.push({ key: "savingThrows", abilities, effect: { kind: "save-bonus", ...(abilities.length === 1 ? { ability: abilities[0] } : {}), bonus: { base: value } } });
  }
  const adjustments = (modifiers.damageAdjustments ?? []).map((adjustment) => ({ kind: "damage-adjustment" as const, condition: "always" as const, adjustment }));
  for (const card of effectCards(adjustments)) cards.push({ key: "damageAdjustments", effect: card.effect, damageTypes: card.damageTypes });
  for (const key of READ_ONLY_MODIFIERS) {
    const value = modifiers[key];
    if (key === "movementMultiplier" ? value !== undefined && value !== 1 : Boolean(value)) cards.push({ key });
  }
  return cards;
}

/** Just the modifiers one card stands for, for its sentence. */
export function modifierCardPart(modifiers: ConditionModifiers, card: ModifierCardView): ConditionModifiers {
  if (!card.effect) return { [card.key]: modifiers[card.key] };
  return withModifierCard(undefined, { key: card.key }, { effect: card.effect, abilities: card.abilities, damageTypes: card.damageTypes }) ?? {};
}

/** The modifiers with one card's edit written back (or the card removed, with `next` undefined). */
export function withModifierCard(
  modifiers: ConditionModifiers | undefined,
  card: ModifierCardView,
  next: { effect: FeatureEffect; abilities?: Ability[]; damageTypes?: DamageAdjustment["damageType"][] } | undefined
): ConditionModifiers | undefined {
  const out: ConditionModifiers = { ...(modifiers ?? {}) };
  const number = (effect: FeatureEffect | undefined): number | undefined => {
    if (!effect) return undefined;
    if (effect.kind === "incoming-attack-modifier") return effect.amount || undefined;
    if (effect.kind === "armor-class-bonus" || effect.kind === "attack-bonus" || effect.kind === "save-bonus") return effect.bonus.base || undefined;
    return undefined;
  };
  switch (card.key) {
    case "armorClass":
    case "attackRoll":
    case "incomingAttackRoll": {
      const value = number(next?.effect);
      delete out[card.key];
      if (value !== undefined) out[card.key] = value;
      break;
    }
    case "savingThrows": {
      const saves = { ...(out.savingThrows ?? {}) };
      for (const ability of card.abilities ?? []) delete saves[ability];
      const value = number(next?.effect);
      if (value !== undefined) for (const ability of next?.abilities?.length ? next.abilities : ALL_ABILITIES) saves[ability] = value;
      delete out.savingThrows;
      if (Object.keys(saves).length) out.savingThrows = saves;
      break;
    }
    case "damageAdjustments": {
      const before = card.effect?.kind === "damage-adjustment" ? card.effect.adjustment : undefined;
      const types = new Set(card.damageTypes ?? []);
      const materials = (adjustment: DamageAdjustment) => [...(adjustment.exceptMaterials ?? [])].sort().join(",");
      const mine = (adjustment: DamageAdjustment) => Boolean(before) && adjustment.type === before!.type && types.has(adjustment.damageType)
        && Boolean(adjustment.nonMagicalOnly) === Boolean(before!.nonMagicalOnly) && materials(adjustment) === materials(before!);
      // The card's adjustments go; its edit takes the place of the first of them.
      const list = out.damageAdjustments ?? [];
      const first = list.findIndex(mine);
      const edited = next?.effect.kind === "damage-adjustment" ? next.effect.adjustment : undefined;
      const replaced = edited ? (next!.damageTypes?.length ? next!.damageTypes : [edited.damageType]).map((damageType) => ({ ...edited, damageType })) : [];
      const kept: DamageAdjustment[] = [];
      list.forEach((adjustment, index) => {
        if (index === first) kept.push(...replaced);
        if (!mine(adjustment)) kept.push(adjustment);
      });
      if (first < 0) kept.push(...replaced);
      delete out.damageAdjustments;
      if (kept.length) out.damageAdjustments = kept;
      break;
    }
    default:
      // Shown, not edited: only removing it is offered.
      if (!next) delete out[card.key];
  }
  return Object.keys(out).length ? out : undefined;
}

/* ─── bonus formulas ─────────────────────────────────────────────────────── */

/**
 * How a bonus is edited: a number (+1 AC), an ability's modifier (Aura of Protection's CHA), or a formula that adds more
 * (a number and a modifier, a proficiency bonus, a multiplier), which a card reads out and the JSON view changes.
 */
export function formulaShape(formula: NumericFormula): "number" | "ability" | "formula" {
  const plain = !formula.proficiency && (formula.multiplier ?? 1) === 1;
  if (plain && !formula.ability) return "number";
  if (plain && !formula.base) return "ability";
  return "formula";
}

/** A formula in words: "1 + CHA modifier + proficiency bonus", "half of proficiency bonus, rounded down". */
export function formulaWords(formula: NumericFormula): string {
  const ability = formula.ability === "spellcasting" ? "spellcasting modifier" : formula.ability ? `${formula.ability.toUpperCase()} modifier` : undefined;
  const parts = [
    ...(formula.base ? [String(formula.base)] : []),
    ...(ability ? [ability] : []),
    ...(formula.proficiency ? ["proficiency bonus"] : [])
  ];
  const sum = parts.length ? parts.join(" + ") : "0";
  const multiplier = formula.multiplier ?? 1;
  if (multiplier === 1) return sum;
  // The engine multiplies the whole sum, then drops any fraction.
  const whole = parts.length > 1 ? `(${sum})` : sum;
  return multiplier === 0.5 ? `half of ${whole}, rounded down` : `${whole} × ${multiplier}`;
}
