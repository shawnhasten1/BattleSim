/**
 * Field schemas + draft <-> definition converters for the three guided builders.
 * Pure functions only (no JSX) so `builder-fields.test.tsx` can exercise the
 * progressive-disclosure logic directly.
 */
import type {
  Ability,
  ActionDefinition,
  ActionRider,
  AreaTargeting,
  AreaTemplate,
  DamageComponent,
  DamageType,
  DeathEffectDefinition,
  FeatureDefinition,
  FeatureEffect,
  FeatureEffectConditionApplication,
  ReactionMeta,
  ReactionTrigger,
  SpellDefinition,
  WeaponDefinition,
  ZoneMovementDamage,
  ZonePersistence,
  ZoneTerrainEffect,
  ZoneTrigger
} from "@/engine";
import type { BuilderDraft, FieldSpec } from "./field-spec";

export type { BuilderDraft } from "./field-spec";

/* ─── dice helpers ─────────────────────────────────────────────────────────── */

export interface DiceValue {
  count: number;
  die: number;
  mod: number;
  type?: string;
  addAbility?: boolean;
}

const DEFAULT_DICE: DiceValue = { count: 1, die: 6, mod: 0, type: "bludgeoning" };

export function parseDiceValue(dice: string | undefined, type?: string, addAbility?: boolean): DiceValue {
  const match = /^\s*(\d+)d(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(dice ?? "");
  if (!match) {
    return { ...DEFAULT_DICE, type, addAbility };
  }
  return {
    count: Number(match[1]),
    die: Number(match[2]),
    mod: match[3] ? Number(match[3].replace(/\s+/g, "")) : 0,
    type,
    addAbility
  };
}

export function diceValueToString(value: DiceValue | undefined): string {
  const v = value ?? DEFAULT_DICE;
  const count = Math.max(1, Math.floor(v.count || 1));
  const die = Math.max(2, Math.floor(v.die || 6));
  const mod = Math.floor(v.mod || 0);
  return `${count}d${die}${mod ? (mod > 0 ? `+${mod}` : String(mod)) : ""}`;
}

function diceToComponent(value: DiceValue | undefined, fallbackAbility: Ability): DamageComponent {
  const v = value ?? DEFAULT_DICE;
  return {
    dice: diceValueToString(v),
    damageType: (v.type as DamageComponent["damageType"]) ?? "bludgeoning",
    abilityModifier: v.addAbility ? fallbackAbility : undefined
  };
}

/* ─── option lists ────────────────────────────────────────────────────────── */

const ABILITY_OPTIONS = [
  { value: "str", label: "STR" }, { value: "dex", label: "DEX" }, { value: "con", label: "CON" },
  { value: "int", label: "INT" }, { value: "wis", label: "WIS" }, { value: "cha", label: "CHA" }
] as const;

const TIMING_OPTIONS = [
  { value: "action", label: "Action" },
  { value: "bonus", label: "Bonus action" },
  { value: "reaction", label: "Reaction" }
] as const;

const SHAPE_OPTIONS = [
  { value: "attack", label: "Attack roll" },
  { value: "save", label: "Saving throw (one target)" },
  { value: "area", label: "Saving throw (area)" },
  { value: "healing", label: "Healing" },
  { value: "reposition", label: "Teleport / reposition" },
  { value: "buff", label: "Beneficial condition (buff)" }
] as const;

const REPOSITION_TARGET_OPTIONS = [
  { value: "self", label: "The caster" },
  { value: "single", label: "One creature" }
] as const;

const BUFF_TARGET_OPTIONS = [
  { value: "self", label: "The caster" },
  { value: "single", label: "One creature" },
  { value: "chosen", label: "Several creatures you choose" }
] as const;

const HEAL_TARGET_OPTIONS = [
  { value: "single", label: "One creature" },
  { value: "self", label: "The caster" },
  { value: "chosen", label: "Several creatures you choose" },
  { value: "area", label: "Everyone in an area" }
] as const;

const AREA_OPTIONS = [
  { value: "circle", label: "Circle" }, { value: "cone", label: "Cone" },
  { value: "line", label: "Line" }, { value: "rectangle", label: "Rectangle" }, { value: "square", label: "Square" }
] as const;

/**
 * A death effect has no one choosing where to aim it, so directional shapes
 * (cone / line / rectangle) would always point the same hardcoded way — a
 * confusing trap. Only origin-symmetric shapes are offered.
 */
const DEATH_EFFECT_AREA_OPTIONS = [
  { value: "circle", label: "Circle" }, { value: "square", label: "Square" }
] as const;

const ON_SUCCESS_OPTIONS = [
  { value: "half", label: "Half damage" },
  { value: "none", label: "No damage" },
  { value: "negates", label: "Effect negated" }
] as const;

/* ─── reaction trigger ────────────────────────────────────────────────────── */

export const REACTION_TRIGGER_KINDS = [
  { value: "enemy-leaves-reach", label: "An enemy leaves my reach" },
  { value: "targeted-by-attack", label: "I'm targeted by an attack" },
  { value: "hit-by-attack", label: "I'm hit by an attack" },
  { value: "ally-targeted-by-attack", label: "An ally near me is targeted" },
  { value: "enemy-casts-spell", label: "An enemy nearby casts a spell" },
  { value: "manual", label: "A trigger I'll describe" }
] as const;

export function blankReactionTrigger(kind: ReactionTrigger["kind"]): ReactionTrigger {
  switch (kind) {
    case "targeted-by-attack": return { kind, meleeOnly: false };
    case "hit-by-attack": return { kind, meleeOnly: false };
    case "ally-targeted-by-attack": return { kind, withinFt: 5 };
    case "enemy-casts-spell": return { kind, withinFt: 60 };
    case "manual": return { kind, note: "" };
    case "enemy-leaves-reach":
    default: return { kind: "enemy-leaves-reach" };
  }
}

function reactionMetaFromDraft(draft: BuilderDraft): ReactionMeta | undefined {
  if (draft.timing !== "reaction" && draft.activateAs !== "reaction") {
    return undefined;
  }
  const trigger = (draft.reactionTrigger as ReactionTrigger | undefined) ?? { kind: "enemy-leaves-reach" };
  const target = draft.reactionTarget === "self" || draft.reactionTarget === "trigger-target" ? draft.reactionTarget : undefined;
  const priority = draft.reactionPriority === "always" || draft.reactionPriority === "manual" || draft.reactionPriority === "worthwhile"
    ? draft.reactionPriority
    : undefined;
  return { trigger, target, priority };
}

/* ─── weapon ──────────────────────────────────────────────────────────────── */

export function weaponFieldSchema(draft: BuilderDraft): FieldSpec[] {
  const isFocus = draft.weaponKind === "focus";
  const isMelee = !isFocus && draft.weaponKind !== "ranged";
  const hasAttack = (d: BuilderDraft) => d.weaponKind !== "focus";
  return [
    { key: "name", copy: "name", control: "text" },
    {
      key: "weaponKind", copy: "weapon.kind", control: "select",
      options: [{ value: "melee", label: "Melee" }, { value: "ranged", label: "Ranged" }, { value: "focus", label: "Spellcasting focus (no attack)" }]
    },
    { key: "ability", copy: "weapon.ability", control: "ability", visibleWhen: hasAttack },
    { key: "dmg", copy: "weapon.damage", control: "dice", visibleWhen: hasAttack },
    { key: "magicBonus", copy: "weapon.magicBonus", control: "number", min: 0, max: 3, step: 1, visibleWhen: hasAttack },
    { key: "magical", copy: "weapon.magical", control: "toggle", visibleWhen: hasAttack },
    { key: "onHit", copy: "weapon.onHit", control: "riders", riderContext: "weapon", visibleWhen: hasAttack },
    { key: "chargesEnabled", copy: "weapon.charges", control: "toggle" },
    { key: "chargesMax", copy: "weapon.chargesMax", control: "number", min: 1, max: 20, step: 1, visibleWhen: (d) => Boolean(d.chargesEnabled) },
    {
      key: "chargesRecharge", copy: "weapon.chargesRecharge", control: "select", visibleWhen: (d) => Boolean(d.chargesEnabled),
      options: [{ value: "dawn", label: "At dawn" }, { value: "short-rest", label: "Short rest" }, { value: "long-rest", label: "Long rest" }]
    },
    { key: "grantedActions", copy: "weapon.grantedActions", control: "granted-actions" },
    { key: "effects", copy: "weapon.effects", control: "feature-effects" },
    { key: "bonusOnly", copy: "weapon.bonusOnly", control: "toggle", advanced: true, visibleWhen: hasAttack },
    { key: "usableAsBonus", copy: "weapon.usableAsBonus", control: "toggle", advanced: true, visibleWhen: (d) => hasAttack(d) && !d.bonusOnly },
    { key: "usableAsReaction", copy: "weapon.usableAsReaction", control: "toggle", advanced: true, visibleWhen: (d) => isMelee && !d.bonusOnly },
    { key: "reactionTrigger", copy: "weapon.reactionTrigger", control: "reaction-trigger", advanced: true, visibleWhen: (d) => isMelee && !d.bonusOnly && Boolean(d.usableAsReaction) },
    { key: "grip", copy: "weapon.grip", control: "select", advanced: true, visibleWhen: () => isMelee,
      options: [{ value: "one-handed", label: "One-handed" }, { value: "two-handed", label: "Two-handed" }, { value: "versatile", label: "Versatile" }] },
    { key: "powerAttack", copy: "weapon.powerAttack", control: "toggle", advanced: true, visibleWhen: hasAttack },
    { key: "nonProficient", copy: "weapon.nonProficient", control: "toggle", advanced: true, visibleWhen: hasAttack },
    { key: "toHitBonus", copy: "weapon.toHitBonus", control: "number", advanced: true, visibleWhen: hasAttack },
    { key: "reach", copy: "weapon.reach", control: "number", advanced: true, visibleWhen: () => isMelee },
    { key: "range", copy: "weapon.range", control: "number", advanced: true, visibleWhen: (d) => hasAttack(d) && !isMelee },
    { key: "longRange", copy: "weapon.longRange", control: "number", advanced: true, visibleWhen: (d) => hasAttack(d) && !isMelee },
    { key: "properties", copy: "weapon.properties", control: "properties", advanced: true, visibleWhen: hasAttack }
  ];
}

export function weaponDraftFromDefinition(weapon: WeaponDefinition): BuilderDraft {
  const primary = weapon.damage[0];
  const usableAs = weapon.usableAs;
  return {
    name: weapon.name,
    weaponKind: weapon.attackType,
    ability: weapon.ability,
    dmg: parseDiceValue(primary?.dice, primary?.damageType, Boolean(primary?.abilityModifier)),
    magicBonus: weapon.magicBonus ?? 0,
    magical: Boolean(weapon.magical),
    onHit: weapon.onHit ?? [],
    grantedActions: grantedDraftsFromActions(weapon.grantedActions),
    effects: weapon.effects ?? [],
    chargesEnabled: Boolean(weapon.charges),
    chargesMax: weapon.charges?.max ?? 1,
    chargesRecharge: typeof weapon.charges?.recharge === "string" ? weapon.charges.recharge : "dawn",
    // advanced fields carry a value only when the weapon deviates from the default
    bonusOnly: usableAs ? (usableAs.includes("bonus") && !usableAs.includes("action")) : false,
    usableAsBonus: usableAs ? (usableAs.includes("bonus") && usableAs.includes("action")) : false,
    usableAsReaction: usableAs ? usableAs.includes("reaction") : weapon.attackType === "melee",
    reactionTrigger: weapon.reactionTrigger,
    grip: weapon.grip && weapon.grip !== "one-handed" ? weapon.grip : undefined,
    powerAttack: Boolean(weapon.powerAttack),
    nonProficient: weapon.proficient === false,
    toHitBonus: weapon.toHitBonus || undefined,
    reach: weapon.attackType === "melee" && weapon.reach && weapon.reach !== 5 ? weapon.reach : undefined,
    range: weapon.attackType === "ranged" ? weapon.range : undefined,
    longRange: weapon.longRange || undefined,
    properties: weapon.properties?.length ? weapon.properties : undefined
  };
}

export function weaponFromDraft(draft: BuilderDraft): WeaponDefinition {
  const kind: WeaponDefinition["attackType"] = draft.weaponKind === "focus" ? "focus" : draft.weaponKind === "ranged" ? "ranged" : "melee";
  const ability = (draft.ability as WeaponDefinition["ability"]) ?? "str";
  const damageAbility: Ability = ability === "finesse" ? "str" : ability;
  const bonusOnly = Boolean(draft.bonusOnly);
  const reactionOn = kind === "melee" && !bonusOnly && draft.usableAsReaction !== false;
  const usableAs: Array<"action" | "bonus" | "reaction"> = bonusOnly
    ? ["bonus"]
    : [
      "action",
      ...(draft.usableAsBonus ? (["bonus"] as const) : []),
      ...(reactionOn ? (["reaction"] as const) : [])
    ];
  const isDefaultSlots = !bonusOnly
    && usableAs.length === (kind === "melee" ? 2 : 1)
    && usableAs.includes("action") && (kind !== "melee" || usableAs.includes("reaction")) && !usableAs.includes("bonus");

  const chargesEnabled = Boolean(draft.chargesEnabled);
  const charges = chargesEnabled
    ? { id: "charge", max: Math.max(1, Number(draft.chargesMax) || 1), recharge: (draft.chargesRecharge as "dawn" | "short-rest" | "long-rest") ?? "dawn" }
    : undefined;
  const grantedActions = (draft.grantedActions as BuilderDraft[] | undefined)?.length
    ? (draft.grantedActions as BuilderDraft[]).map((item) => grantedActionFromDraft(item, chargesEnabled ? "charge" : undefined))
    : undefined;
  const effects = (draft.effects as FeatureEffect[])?.length ? (draft.effects as FeatureEffect[]) : undefined;

  if (kind === "focus") {
    return {
      id: "",
      name: (draft.name as string) || "Weapon",
      attackType: "focus",
      ability: "int",
      range: 0,
      damage: [],
      charges,
      grantedActions,
      effects
    };
  }

  return {
    id: "",
    name: (draft.name as string) || "Weapon",
    attackType: kind,
    ability,
    proficient: draft.nonProficient ? false : undefined,
    magical: draft.magical ? true : undefined,
    toHitBonus: Number(draft.toHitBonus) || undefined,
    magicBonus: Number(draft.magicBonus) || undefined,
    range: kind === "ranged" ? Number(draft.range) || 30 : Number(draft.reach) || 5,
    reach: kind === "melee" ? Number(draft.reach) || 5 : undefined,
    longRange: kind === "ranged" ? Number(draft.longRange) || undefined : undefined,
    damage: [diceToComponent(draft.dmg as DiceValue, damageAbility)],
    properties: (draft.properties as string[])?.length ? (draft.properties as string[]) : undefined,
    onHit: (draft.onHit as ActionRider[])?.length ? (draft.onHit as ActionRider[]) : undefined,
    charges,
    grantedActions,
    effects,
    usableAs: isDefaultSlots ? undefined : usableAs,
    grip: draft.grip === "two-handed" || draft.grip === "versatile" ? draft.grip : undefined,
    powerAttack: draft.powerAttack ? true : undefined,
    reactionTrigger: reactionOn ? (draft.reactionTrigger as ReactionTrigger | undefined) : undefined
  };
}

/* ─── shared effect shape (spell + innate action) ─────────────────────────── */

function effectShapeSpecs(draft: BuilderDraft): FieldSpec[] {
  const shape = draft.shape as string;
  const areaType = draft.areaType as string;
  const inSaveShape = shape === "save" || shape === "area";
  const inDamageShape = shape === "attack" || shape === "save" || shape === "area";
  return [
    { key: "shape", copy: "spell.shape", control: "select", options: SHAPE_OPTIONS as unknown as FieldSpec["options"] },

    { key: "attackAbility", copy: "spell.attackAbility", control: "ability", visibleWhen: () => shape === "attack" },
    { key: "attackDelivery", copy: "spell.attackDelivery", control: "select", advanced: true, visibleWhen: () => shape === "attack",
      options: [{ value: "single", label: "Single" }, { value: "beams", label: "Multiple beams" }] },
    { key: "beamCount", copy: "spell.beamCount", control: "number", advanced: true, min: 1, max: 12,
      visibleWhen: () => shape === "attack" && draft.attackDelivery === "beams" },
    { key: "autoHit", copy: "spell.autoHit", control: "toggle", advanced: true,
      visibleWhen: () => shape === "attack" && draft.attackDelivery === "beams" },

    { key: "castingAbility", copy: "spell.castingAbility", control: "ability", visibleWhen: () => inSaveShape },
    { key: "saveAbility", copy: "spell.saveAbility", control: "ability", visibleWhen: () => inSaveShape },
    { key: "saveDc", copy: "spell.saveDc", control: "number", advanced: true, visibleWhen: () => inSaveShape },
    { key: "onSuccess", copy: "spell.onSuccess", control: "select", options: ON_SUCCESS_OPTIONS as unknown as FieldSpec["options"], visibleWhen: () => inSaveShape },

    { key: "areaType", copy: "area.type", control: "select", options: AREA_OPTIONS as unknown as FieldSpec["options"], visibleWhen: () => shape === "area" || (shape === "healing" && draft.healTarget === "area") },
    { key: "areaSize", copy: "area.size", control: "number", min: 5, step: 5, visibleWhen: () => shape === "area" || (shape === "healing" && draft.healTarget === "area") },
    { key: "areaWidth", copy: "area.width", control: "number", min: 5, step: 5, visibleWhen: () => (shape === "area" || (shape === "healing" && draft.healTarget === "area")) && (areaType === "line" || areaType === "rectangle") },
    { key: "areaOrigin", copy: "area.origin", control: "select", options: [{ value: "point", label: "A point you choose" }, { value: "self", label: "The caster" }], visibleWhen: () => shape === "area" || (shape === "healing" && draft.healTarget === "area") },
    { key: "areaAimed", copy: "area.aimedFromSelf", control: "toggle", visibleWhen: () => (shape === "area" || (shape === "healing" && draft.healTarget === "area")) && (areaType === "cone" || areaType === "line" || areaType === "rectangle") },
    // "Enemies only / everyone" has no healing analog — allies-only is implicit for a heal, so this stays area-save-only.
    { key: "affects", copy: "area.affects", control: "select", advanced: true, options: [{ value: "hostile", label: "Enemies only" }, { value: "all", label: "Everyone in the area" }], visibleWhen: () => shape === "area" },

    { key: "zoneEnabled", copy: "zone.enabled", control: "toggle", advanced: true, visibleWhen: () => shape === "area" },
    { key: "zoneAnchor", copy: "zone.anchor", control: "select", advanced: true,
      options: [{ value: "fixed", label: "Stays where it's cast" }, { value: "self", label: "Follows the caster" }],
      visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) },
    { key: "zoneDurationKind", copy: "zone.durationKind", control: "select", advanced: true,
      options: [{ value: "rounds", label: "A number of rounds" }, { value: "concentration", label: "As long as concentrating" }, { value: "permanent", label: "Until dismissed" }],
      visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) },
    { key: "zoneDurationRounds", copy: "zone.durationRounds", control: "number", advanced: true, min: 1, step: 1,
      visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) && (draft.zoneDurationKind ?? "rounds") === "rounds" },
    { key: "zoneApplyOnCast", copy: "zone.applyOnCast", control: "toggle", advanced: true, visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) },
    { key: "zoneTriggerEnter", copy: "zone.triggerEnter", control: "toggle", advanced: true, visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) },
    { key: "zoneTriggerStart", copy: "zone.triggerStart", control: "toggle", advanced: true, visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) },
    { key: "zoneTriggerEnd", copy: "zone.triggerEnd", control: "toggle", advanced: true, visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) },
    { key: "zoneDrifts", copy: "zone.drifts", control: "toggle", advanced: true,
      visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) && (draft.zoneAnchor ?? "fixed") === "fixed" },
    { key: "zoneDriftFeet", copy: "zone.driftFeet", control: "number", advanced: true, min: 5, step: 5,
      visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) && (draft.zoneAnchor ?? "fixed") === "fixed" && Boolean(draft.zoneDrifts) },
    { key: "zoneMovementDamageEnabled", copy: "zone.movementDamageEnabled", control: "toggle", advanced: true, visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) },
    { key: "zoneMovementDamageDice", copy: "zone.movementDamage", control: "dice", advanced: true,
      visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) && Boolean(draft.zoneMovementDamageEnabled) },
    { key: "zoneTerrainEnabled", copy: "zone.terrainEnabled", control: "toggle", advanced: true, visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) },
    { key: "zoneTerrainType", copy: "zone.terrainType", control: "select", advanced: true,
      options: [{ value: "difficult", label: "Difficult terrain" }, { value: "impassable", label: "Impassable" }],
      visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) && Boolean(draft.zoneTerrainEnabled) },
    { key: "zoneTerrainMultiplier", copy: "zone.terrainMultiplier", control: "number", advanced: true, min: 1, step: 1,
      visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) && Boolean(draft.zoneTerrainEnabled) && (draft.zoneTerrainType ?? "difficult") === "difficult" },
    { key: "zoneBlocksSight", copy: "zone.blocksSight", control: "toggle", advanced: true, visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) },
    { key: "zoneRepositionable", copy: "zone.repositionable", control: "toggle", advanced: true,
      visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) && (draft.zoneAnchor ?? "fixed") === "fixed" },
    { key: "zoneRepositionFeet", copy: "zone.repositionFeet", control: "number", advanced: true, min: 5, step: 5,
      visibleWhen: () => shape === "area" && Boolean(draft.zoneEnabled) && (draft.zoneAnchor ?? "fixed") === "fixed" && Boolean(draft.zoneRepositionable) },

    { key: "dealsDamage", copy: "spell.dealsDamage", control: "toggle", visibleWhen: () => shape === "save" || shape === "area" },
    { key: "dmg", copy: "spell.damage", control: "dice", visibleWhen: () => inDamageShape && (shape === "attack" || Boolean(draft.dealsDamage)) },

    { key: "healDice", copy: "spell.healDice", control: "dice", visibleWhen: () => shape === "healing" },
    { key: "healTarget", copy: "spell.healTarget", control: "select", options: HEAL_TARGET_OPTIONS as unknown as FieldSpec["options"], visibleWhen: () => shape === "healing" },
    { key: "healChosenCount", copy: "spell.healChosenCount", control: "number", min: 1, step: 1,
      visibleWhen: () => shape === "healing" && draft.healTarget === "chosen" },

    // Range doubles as the teleport distance here (shared top-level field, no separate spec needed).
    { key: "repositionTarget", copy: "spell.repositionTarget", control: "select", options: REPOSITION_TARGET_OPTIONS as unknown as FieldSpec["options"], visibleWhen: () => shape === "reposition" },
    { key: "repositionRequiresLos", copy: "spell.repositionRequiresLos", control: "toggle", advanced: true, visibleWhen: () => shape === "reposition" },

    // Buff — a curated flat subset of ConditionInstance.modifiers (AC / attack
    // roll / a single save-bonus applied to all six abilities) covering Bless
    // and Shield of Faith exactly; `buffEffects` (full FeatureEffect[], reusing
    // the same "feature-effects" control the feature builder already uses) is
    // the escape hatch for anything beyond that. No condition-name field —
    // always authored as "custom", since neither worked example needs a real
    // ConditionName.
    { key: "buffTarget", copy: "spell.buffTarget", control: "select", options: BUFF_TARGET_OPTIONS as unknown as FieldSpec["options"], visibleWhen: () => shape === "buff" },
    { key: "buffChosenCount", copy: "spell.buffChosenCount", control: "number", min: 1, step: 1,
      visibleWhen: () => shape === "buff" && draft.buffTarget === "chosen" },
    { key: "buffDurationRounds", copy: "spell.buffDurationRounds", control: "number", min: 1, step: 1, visibleWhen: () => shape === "buff" },
    { key: "buffAcBonus", copy: "spell.buffAcBonus", control: "number", advanced: true, visibleWhen: () => shape === "buff" },
    { key: "buffAttackRollBonus", copy: "spell.buffAttackRollBonus", control: "number", advanced: true, visibleWhen: () => shape === "buff" },
    { key: "buffSaveBonus", copy: "spell.buffSaveBonus", control: "number", advanced: true, visibleWhen: () => shape === "buff" },
    { key: "buffTempHpEnabled", copy: "spell.buffTempHpEnabled", control: "toggle", advanced: true, visibleWhen: () => shape === "buff" },
    { key: "buffTempHpDice", copy: "spell.buffTempHpDice", control: "dice", advanced: true, visibleWhen: () => shape === "buff" && Boolean(draft.buffTempHpEnabled) },
    { key: "buffEffects", copy: "spell.buffEffects", control: "feature-effects", advanced: true, visibleWhen: () => shape === "buff" },

    { key: "riders", copy: "spell.riders", control: "riders", riderContext: inSaveShape ? "save" : "weapon", visibleWhen: () => inDamageShape }
  ];
}

/* ─── spell ───────────────────────────────────────────────────────────────── */

/** Reaction block shown when the action / spell casting time is "Reaction". */
function reactionBlockSpecs(triggerCopy: string, targetCopy: string, priorityCopy: string, when: (d: BuilderDraft) => boolean): FieldSpec[] {
  return [
    { key: "reactionTrigger", copy: triggerCopy, control: "reaction-trigger", visibleWhen: when },
    { key: "reactionTarget", copy: targetCopy, control: "select", advanced: true, visibleWhen: when,
      options: [{ value: "trigger-source", label: "The attacker / caster" }, { value: "trigger-target", label: "The attack's target" }, { value: "self", label: "Me" }] },
    { key: "reactionPriority", copy: priorityCopy, control: "select", advanced: true, visibleWhen: when,
      options: [{ value: "worthwhile", label: "When it's worth it" }, { value: "always", label: "Whenever possible" }, { value: "manual", label: "Never automatically" }] }
  ];
}

export function spellFieldSchema(draft: BuilderDraft): FieldSpec[] {
  return [
    { key: "name", copy: "name", control: "text" },
    { key: "level", copy: "spell.level", control: "number", min: 0, max: 9, step: 1 },
    { key: "timing", copy: "timing", control: "select", options: TIMING_OPTIONS as unknown as FieldSpec["options"] },
    ...reactionBlockSpecs("spell.reactionTrigger", "spell.reactionTarget", "spell.reactionPriority", (d) => d.timing === "reaction"),
    {
      key: "range",
      copy: draft.shape === "reposition" ? "spell.repositionRange" : "spell.range",
      control: "text",
      placeholder: draft.shape === "reposition" ? "30" : "60"
    },
    ...effectShapeSpecs(draft),
    { key: "concentration", copy: "spell.concentration", control: "toggle", advanced: true },
    { key: "ritual", copy: "spell.ritual", control: "toggle", advanced: true },
    { key: "resourceId", copy: "spell.resourceId", control: "text", advanced: true, placeholder: "slot-1" },
    { key: "upcastDamage", copy: "spell.upcastDamage", control: "text", advanced: true, placeholder: "1d6" }
  ];
}

/* ─── death effect ───────────────────────────────────────────────────────── */

/**
 * A death effect fires automatically when the creature drops to 0 HP — there is
 * no caster spending an action, choosing a casting time, or aiming a template.
 * So unlike `spellFieldSchema` / `actionFieldSchema`, this doesn't spread
 * `effectShapeSpecs` (which bundles the attack / save / healing shapes and the
 * point-vs-self / aimed-cone fields that only make sense when someone is
 * choosing a target): the engine only ever resolves the area-save shape
 * automatically, centred on the dying creature, so that's the only shape this
 * builder offers.
 */
export function deathEffectFieldSchema(draft: BuilderDraft): FieldSpec[] {
  return [
    { key: "name", copy: "name", control: "text" },
    { key: "areaType", copy: "area.type", control: "select", options: DEATH_EFFECT_AREA_OPTIONS as unknown as FieldSpec["options"] },
    { key: "areaSize", copy: "area.size", control: "number", min: 5, step: 5 },
    { key: "saveAbility", copy: "spell.saveAbility", control: "ability" },
    { key: "saveDc", copy: "spell.saveDc", control: "number", advanced: true },
    { key: "onSuccess", copy: "spell.onSuccess", control: "select", options: ON_SUCCESS_OPTIONS as unknown as FieldSpec["options"] },
    { key: "affects", copy: "area.affects", control: "select", advanced: true,
      options: [{ value: "hostile", label: "Enemies only" }, { value: "all", label: "Everyone in the area" }] },
    { key: "dealsDamage", copy: "spell.dealsDamage", control: "toggle" },
    { key: "dmg", copy: "spell.damage", control: "dice", visibleWhen: (d) => Boolean(d.dealsDamage) },
    { key: "riders", copy: "spell.riders", control: "riders", riderContext: "save" },
    { key: "description", copy: "deathEffect.description", control: "text", advanced: true }
  ];
}

export function deathEffectDraftFromDefinition(deathEffect: DeathEffectDefinition): BuilderDraft {
  return {
    ...effectDraftFromAction(deathEffect.action),
    name: deathEffect.name,
    description: deathEffect.description ?? "",
    shape: "area"
  };
}

/** Build a `DeathEffectDefinition` from a draft. Always area-save shaped, self-origin, no range (there is no one to aim it). */
export function deathEffectFromDraft(draft: BuilderDraft): DeathEffectDefinition {
  const action = actionFromEffectDraft({ ...draft, shape: "area", range: "0", areaOrigin: "self" });
  const description = String(draft.description ?? "").trim();
  return {
    id: "",
    name: (draft.name as string) || "Death Effect",
    description: description || undefined,
    action,
    automationSupport: "full"
  };
}

/* ─── innate action ──────────────────────────────────────────────────────── */

export function actionFieldSchema(draft: BuilderDraft): FieldSpec[] {
  return [
    { key: "name", copy: "name", control: "text" },
    { key: "timing", copy: "timing", control: "select", options: TIMING_OPTIONS as unknown as FieldSpec["options"] },
    ...reactionBlockSpecs("spell.reactionTrigger", "spell.reactionTarget", "spell.reactionPriority", (d) => d.timing === "reaction"),
    {
      key: "range",
      copy: draft.shape === "reposition" ? "spell.repositionRange" : "spell.range",
      control: "text",
      placeholder: draft.shape === "reposition" ? "30" : "5"
    },
    ...effectShapeSpecs(draft),
    { key: "concentration", copy: "spell.concentration", control: "toggle", advanced: true }
  ];
}

/* ─── effect drafts <-> ActionDefinition ─────────────────────────────────── */

function shapeOfAction(action: ActionDefinition): string {
  if (action.kind === "attack") return "attack";
  if (action.kind === "save") return "save";
  if (action.kind === "area-save") return "area";
  if (action.kind === "healing") return "healing";
  if (action.kind === "reposition") return "reposition";
  if (action.kind === "buff") return "buff";
  return "attack";
}

function rangeToDraft(range: number | "self" | "touch" | undefined): string {
  if (range === "self" || range === "touch") return range;
  return range == null ? "60" : String(range);
}

function draftRangeToNumber(value: unknown): number {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "self") return 0;
  if (text === "touch") return 5;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n : 60;
}

export function effectDraftFromAction(action: ActionDefinition): BuilderDraft {
  const shape = shapeOfAction(action);
  const reaction = "reaction" in action ? action.reaction : undefined;
  const base: BuilderDraft = {
    name: action.name,
    timing: action.actionType,
    reactionTrigger: reaction?.trigger,
    reactionTarget: reaction?.target,
    reactionPriority: reaction?.priority,
    shape,
    attackAbility: "int",
    attackDelivery: undefined,
    beamCount: 1,
    autoHit: false,
    castingAbility: "int",
    saveAbility: "dex",
    onSuccess: "half",
    areaType: "circle",
    areaSize: 20,
    areaWidth: 5,
    areaOrigin: "point",
    areaAimed: false,
    affects: undefined,
    dealsDamage: true,
    dmg: parseDiceValue("2d6", "fire"),
    healDice: parseDiceValue("1d8"),
    healTarget: "single",
    healChosenCount: 3,
    repositionTarget: "self",
    repositionRequiresLos: false,
    buffTarget: "single",
    buffChosenCount: 3,
    buffDurationRounds: 10,
    buffAcBonus: 0,
    buffAttackRollBonus: 0,
    buffSaveBonus: 0,
    buffTempHpEnabled: false,
    buffTempHpDice: parseDiceValue("2d4"),
    buffEffects: [],
    riders: [],
    concentration: false,
    // Matches every zone-shaped SRD spell so far (Insect Plague, Cloudkill,
    // Web, Moonbeam) — a fresh zone starts with the common pair on.
    zoneTriggerEnter: true,
    zoneTriggerStart: true
  };
  if (action.kind === "attack") {
    const primary = action.damage[0];
    return {
      ...base,
      range: rangeToDraft(action.range),
      attackAbility: action.ability,
      attackDelivery: action.attackDelivery === "beams" ? "beams" : undefined,
      beamCount: action.beamCount ?? 1,
      autoHit: Boolean(action.autoHit),
      dmg: parseDiceValue(primary?.dice, primary?.damageType, Boolean(primary?.abilityModifier)),
      riders: action.riders ?? [],
      concentration: Boolean(action.concentration)
    };
  }
  if (action.kind === "save" || action.kind === "area-save") {
    const primary = action.damage[0];
    const areaExtra = action.kind === "area-save"
      ? {
        areaType: action.area.type,
        areaSize: action.area.size,
        areaWidth: action.area.width ?? 5,
        areaOrigin: action.targeting?.origin ?? "point",
        areaAimed: Boolean(action.targeting?.aimedFromSelf),
        affects: action.affects === "all" ? "all" : undefined,
        zoneEnabled: Boolean(action.zone),
        zoneAnchor: action.zone?.anchor ?? "fixed",
        zoneDurationKind: action.zone?.duration.kind ?? "rounds",
        zoneDurationRounds: action.zone?.duration.kind === "rounds" ? action.zone.duration.rounds : 10,
        zoneApplyOnCast: Boolean(action.zone?.applyOnCast),
        // Default to the common on-enter + start-of-turn pair when there's no
        // existing zone yet (enabling the toggle for the first time) rather
        // than decompiling to all-false, which would silently build a zone
        // that never triggers.
        zoneTriggerEnter: action.zone ? action.zone.trigger.includes("on-enter") : true,
        zoneTriggerStart: action.zone ? action.zone.trigger.includes("start-of-turn-in-zone") : true,
        zoneTriggerEnd: Boolean(action.zone?.trigger.includes("end-of-turn-in-zone")),
        zoneDrifts: Boolean(action.zone?.movement),
        zoneDriftFeet: action.zone?.movement?.driftFeetPerCasterTurn ?? 10,
        zoneMovementDamageEnabled: Boolean(action.zone?.movementDamage),
        zoneMovementDamageDice: action.zone?.movementDamage
          ? parseDiceValue(action.zone.movementDamage.dice, action.zone.movementDamage.damageType)
          : parseDiceValue("2d4", "piercing"),
        zoneTerrainEnabled: Boolean(action.zone?.terrain),
        zoneTerrainType: action.zone?.terrain?.type ?? "difficult",
        zoneTerrainMultiplier: action.zone?.terrain?.movementMultiplier ?? 2,
        zoneBlocksSight: Boolean(action.zone?.blocksSight),
        zoneRepositionable: Boolean(action.zone?.repositionable),
        zoneRepositionFeet: action.zone?.repositionable?.maxFeetPerCasterTurn ?? 60
      }
      : {};
    return {
      ...base,
      ...areaExtra,
      range: rangeToDraft(action.range),
      castingAbility: action.dcFormula?.ability ?? action.saveAbility,
      saveAbility: action.saveAbility,
      saveDc: action.dc,
      onSuccess: action.onSuccess ?? (action.halfDamageOnSuccess ? "half" : "none"),
      dealsDamage: action.damage.length > 0,
      dmg: parseDiceValue(primary?.dice, primary?.damageType, Boolean(primary?.abilityModifier)),
      riders: action.riders ?? [],
      concentration: Boolean(action.concentration)
    };
  }
  if (action.kind === "healing") {
    const primary = action.healing[0];
    return {
      ...base,
      range: rangeToDraft(action.range),
      healDice: parseDiceValue(primary?.dice, undefined, Boolean(primary?.abilityModifier)),
      healTarget: action.targeting?.target ?? "single",
      healChosenCount: action.targeting?.count ?? 3,
      areaType: action.area?.type ?? "circle",
      areaSize: action.area?.size ?? 20,
      areaWidth: action.area?.width ?? 5
    };
  }
  if (action.kind === "reposition") {
    return {
      ...base,
      range: rangeToDraft(action.range),
      repositionTarget: action.targeting?.target === "single" ? "single" : "self",
      repositionRequiresLos: Boolean(action.requiresLineOfEffect),
      concentration: Boolean(action.concentration)
    };
  }
  if (action.kind === "buff") {
    const modifiers = action.appliedCondition.modifiers;
    const savingThrows = modifiers?.savingThrows;
    // The builder's `buffSaveBonus` is a single flat number applied to all six
    // abilities (curated v1 field) — decompile it from whichever ability the
    // authored condition happens to carry (they're all authored equal by this
    // same builder), falling back to 0 for a hand-authored asymmetric bonus
    // the flat field can't represent (edits via `buffEffects` instead).
    const flatSaveBonus = savingThrows
      ? Object.values(savingThrows).find((value): value is number => typeof value === "number") ?? 0
      : 0;
    const primaryTempHp = action.tempHp?.[0];
    return {
      ...base,
      range: rangeToDraft(action.range),
      buffTarget: action.targeting?.target ?? "single",
      buffChosenCount: action.targeting?.count ?? 3,
      buffDurationRounds: action.appliedCondition.durationRounds ?? 10,
      buffAcBonus: modifiers?.armorClass ?? 0,
      buffAttackRollBonus: modifiers?.attackRoll ?? 0,
      buffSaveBonus: flatSaveBonus,
      buffTempHpEnabled: Boolean(primaryTempHp),
      buffTempHpDice: primaryTempHp ? parseDiceValue(primaryTempHp.dice, undefined, Boolean(primaryTempHp.abilityModifier)) : parseDiceValue("2d4"),
      buffEffects: action.appliedCondition.effects ?? [],
      concentration: Boolean(action.concentration)
    };
  }
  return { ...base, range: "60" };
}

/** MVP scope: fixed-origin only. Each trigger kind is its own independent toggle — see `ZonePersistence`. */
function zoneFromDraft(draft: BuilderDraft): ZonePersistence {
  const trigger: ZoneTrigger[] = [];
  if (draft.zoneTriggerEnter) {
    trigger.push("on-enter");
  }
  if (draft.zoneTriggerStart) {
    trigger.push("start-of-turn-in-zone");
  }
  if (draft.zoneTriggerEnd) {
    trigger.push("end-of-turn-in-zone");
  }
  const durationKind = (draft.zoneDurationKind as ZonePersistence["duration"]["kind"]) ?? "rounds";
  const duration: ZonePersistence["duration"] = durationKind === "rounds"
    ? { kind: "rounds", rounds: Math.max(1, Number(draft.zoneDurationRounds) || 10) }
    : { kind: durationKind };
  const movementDamageDice = draft.zoneMovementDamageDice as DiceValue | undefined;
  const movementDamage: ZoneMovementDamage | undefined = draft.zoneMovementDamageEnabled
    ? { dice: diceValueToString(movementDamageDice ?? DEFAULT_DICE), damageType: (movementDamageDice?.type as DamageType) ?? "piercing" }
    : undefined;
  return {
    duration,
    trigger,
    anchor: (draft.zoneAnchor as "fixed" | "self") ?? "fixed",
    movement: draft.zoneDrifts ? { driftFeetPerCasterTurn: Math.max(5, Number(draft.zoneDriftFeet) || 10) } : undefined,
    repositionable: draft.zoneRepositionable ? { maxFeetPerCasterTurn: Math.max(5, Number(draft.zoneRepositionFeet) || 60) } : undefined,
    movementDamage,
    terrain: draft.zoneTerrainEnabled
      ? {
        type: (draft.zoneTerrainType as ZoneTerrainEffect["type"]) ?? "difficult",
        movementMultiplier: (draft.zoneTerrainType ?? "difficult") === "difficult"
          ? Math.max(1, Number(draft.zoneTerrainMultiplier) || 2)
          : undefined
      }
      : undefined,
    blocksSight: draft.zoneBlocksSight ? true : undefined,
    applyOnCast: draft.zoneApplyOnCast ? true : undefined
  };
}

type BuildableAction = Extract<ActionDefinition, { kind: "attack" | "save" | "area-save" | "healing" | "reposition" | "buff" }>;

/** Shared by the `"area"` shape and `"healing"` shape's own area sub-mode — avoids constructing the same `AreaTemplate` twice. */
function areaTemplateFromDraft(draft: BuilderDraft): AreaTemplate {
  return {
    type: (draft.areaType as AreaTemplate["type"]) ?? "circle",
    size: Math.max(5, Number(draft.areaSize) || 20),
    width: (draft.areaType === "line" || draft.areaType === "rectangle") ? Math.max(5, Number(draft.areaWidth) || 5) : undefined
  };
}

/** Shared by the `"area"` shape and `"healing"` shape's own area sub-mode — avoids constructing the same `AreaTargeting` twice. */
function areaTargetingFromDraft(draft: BuilderDraft, range: number): AreaTargeting {
  return {
    // A self-anchored zone recenters on the caster regardless of where it's
    // aimed (`recenterSelfAnchoredZones` in combat.ts) — force self-origin so
    // the initial placement matches where it'll actually settle. (Only
    // meaningful for the `"area"` shape's own zone feature; `draft.zoneAnchor`
    // is simply absent for a healing draft.)
    origin: (draft.areaOrigin === "self" || draft.zoneAnchor === "self") ? "self" : "point",
    aimedFromSelf: draft.areaAimed ? true : undefined,
    range
  };
}

/** Build an `ActionDefinition` skeleton from an effect draft (store normalization fills the rest). */
export function actionFromEffectDraft(draft: BuilderDraft, options: { spell?: boolean } = {}): BuildableAction {
  const shape = draft.shape as string;
  const name = (draft.name as string) || "Ability";
  const actionType = (draft.timing as "action" | "bonus" | "reaction") ?? "action";
  const range = draftRangeToNumber(draft.range);
  const riders = ((draft.riders as ActionRider[]) ?? []).filter(Boolean);
  const dmg = diceToComponent(draft.dmg as DiceValue, "int");
  const dcValue = Number(draft.saveDc);
  const dcFormula = { base: 8, ability: (draft.castingAbility as Ability) ?? "int", proficiency: true };
  const reaction = actionType === "reaction" ? reactionMetaFromDraft(draft) : undefined;

  if (shape === "attack") {
    return {
      kind: "attack", id: "", name, actionType, reaction,
      attackType: options.spell ? "spell" : "ranged",
      ability: (draft.attackAbility as Ability) ?? "int",
      attackBonusFormula: { ability: (draft.attackAbility as Ability) ?? "int", proficiency: true },
      range,
      attackDelivery: draft.attackDelivery === "beams" ? "beams" : undefined,
      beamCount: draft.attackDelivery === "beams" ? Math.max(1, Number(draft.beamCount) || 1) : undefined,
      autoHit: draft.attackDelivery === "beams" && draft.autoHit ? true : undefined,
      damage: [dmg],
      riders: riders.length ? riders : undefined,
      concentration: draft.concentration ? true : undefined,
      automationSupport: "full"
    };
  }
  if (shape === "healing") {
    const healTarget = draft.healTarget as string | undefined;
    const targeting = healTarget === "self" ? { target: "self" as const }
      : healTarget === "chosen" ? { target: "chosen" as const, count: Math.max(1, Number(draft.healChosenCount) || 3) }
        : healTarget === "area" ? { target: "area" as const }
          : { target: "single" as const };
    return {
      kind: "healing", id: "", name, actionType, range,
      healing: [{ dice: diceValueToString(draft.healDice as DiceValue), abilityModifier: (draft.healDice as DiceValue)?.addAbility ? "wis" : undefined }],
      targeting,
      area: healTarget === "area" ? areaTemplateFromDraft(draft) : undefined,
      areaTargeting: healTarget === "area" ? areaTargetingFromDraft(draft, range) : undefined,
      automationSupport: "full"
    };
  }
  if (shape === "reposition") {
    return {
      kind: "reposition", id: "", name, actionType, range,
      targeting: draft.repositionTarget === "single" ? { target: "single" } : { target: "self" },
      requiresLineOfEffect: draft.repositionRequiresLos ? true : undefined,
      concentration: draft.concentration ? true : undefined,
      automationSupport: "full"
    };
  }
  if (shape === "buff") {
    const buffTarget = draft.buffTarget as string | undefined;
    const targeting = buffTarget === "self" ? { target: "self" as const }
      : buffTarget === "chosen" ? { target: "chosen" as const, count: Math.max(1, Number(draft.buffChosenCount) || 3) }
        : { target: "single" as const };
    const savingThrows = Number(draft.buffSaveBonus) || 0
      ? { str: Number(draft.buffSaveBonus), dex: Number(draft.buffSaveBonus), con: Number(draft.buffSaveBonus), int: Number(draft.buffSaveBonus), wis: Number(draft.buffSaveBonus), cha: Number(draft.buffSaveBonus) }
      : undefined;
    const appliedCondition: FeatureEffectConditionApplication = {
      name: "custom",
      durationRounds: Math.max(1, Number(draft.buffDurationRounds) || 10),
      modifiers: {
        armorClass: Number(draft.buffAcBonus) || undefined,
        attackRoll: Number(draft.buffAttackRollBonus) || undefined,
        savingThrows
      },
      effects: (draft.buffEffects as FeatureEffect[])?.length ? (draft.buffEffects as FeatureEffect[]) : undefined
    };
    const tempHpDice = draft.buffTempHpDice as DiceValue | undefined;
    return {
      kind: "buff", id: "", name, actionType, range,
      targeting,
      appliedCondition,
      tempHp: draft.buffTempHpEnabled && tempHpDice ? [{ dice: diceValueToString(tempHpDice) }] : undefined,
      concentration: draft.concentration ? true : undefined,
      automationSupport: "full"
    };
  }
  const onSuccess = (draft.onSuccess as "half" | "none" | "negates") ?? "half";
  const damage = draft.dealsDamage === false ? [] : [dmg];
  if (shape === "area") {
    return {
      kind: "area-save", id: "", name, actionType, range, reaction,
      saveAbility: (draft.saveAbility as Ability) ?? "dex",
      dc: Number.isFinite(dcValue) && dcValue > 0 ? dcValue : undefined,
      dcFormula: Number.isFinite(dcValue) && dcValue > 0 ? undefined : dcFormula,
      area: areaTemplateFromDraft(draft),
      targeting: areaTargetingFromDraft(draft, range),
      damage,
      halfDamageOnSuccess: onSuccess === "half",
      onSuccess,
      affects: draft.affects === "all" ? "all" : "hostile",
      riders: riders.length ? riders : undefined,
      concentration: draft.concentration ? true : undefined,
      zone: draft.zoneEnabled ? zoneFromDraft(draft) : undefined,
      automationSupport: "full"
    };
  }
  return {
    kind: "save", id: "", name, actionType, range, reaction,
    saveAbility: (draft.saveAbility as Ability) ?? "dex",
    dc: Number.isFinite(dcValue) && dcValue > 0 ? dcValue : undefined,
    dcFormula: Number.isFinite(dcValue) && dcValue > 0 ? undefined : dcFormula,
    damage,
    halfDamageOnSuccess: onSuccess === "half",
    onSuccess,
    riders: riders.length ? riders : undefined,
    concentration: draft.concentration ? true : undefined,
    automationSupport: "full"
  };
}

/* ─── granted-action drafts (weapon / focus `grantedActions`) ─────────────── */

const BLANK_GRANTED_ACTION: ActionDefinition = {
  kind: "attack",
  id: "",
  name: "Granted Spell",
  actionType: "action",
  attackType: "spell",
  ability: "int",
  range: 60,
  damage: [{ dice: "1d10", damageType: "fire" }],
  automationSupport: "full"
};

export function blankGrantedDraft(): BuilderDraft {
  return { ...effectDraftFromAction(BLANK_GRANTED_ACTION), chargeCost: 0 };
}

export function grantedDraftsFromActions(actions: ActionDefinition[] | undefined): BuilderDraft[] {
  return (actions ?? []).map((action) => ({
    ...effectDraftFromAction(action),
    chargeCost: "resourceCost" in action ? action.resourceCost?.amount ?? 0 : 0
  }));
}

/**
 * Convert one granted-action draft back to a compiled `ActionDefinition`.
 * `chargeResourceId` is the weapon's own charge-pool id — pass `undefined`
 * when the weapon has no pool enabled, which drops any charge cost the card
 * was showing (nothing to spend it from).
 */
export function grantedActionFromDraft(draft: BuilderDraft, chargeResourceId: string | undefined): ActionDefinition {
  const action = actionFromEffectDraft(draft, { spell: true });
  const amount = Math.max(0, Number(draft.chargeCost) || 0);
  return {
    ...action,
    // Every granted action is treated as a spell for scoping purposes (a
    // focus's own spell-attack / save-DC / damage-type bonuses, and any other
    // item's, apply to it) — cantrip-level (0) unless the author raises it.
    spellLevel: action.spellLevel ?? 0,
    resourceCost: chargeResourceId && amount > 0 ? { resourceId: chargeResourceId, amount } : undefined
  };
}

/* ─── spell drafts <-> SpellDefinition ───────────────────────────────────── */

export function spellDraftFromDefinition(spell: SpellDefinition): BuilderDraft {
  const effect = spell.action ? effectDraftFromAction(spell.action) : { shape: "attack" };
  return {
    ...effectDraftFromAction(spell.action ?? ({ kind: "attack", id: "", name: spell.name, actionType: "action", attackType: "spell", ability: "int", range: 60, damage: [{ dice: "1d10", damageType: "fire" }], automationSupport: "full" } as ActionDefinition)),
    ...effect,
    name: spell.name,
    level: spell.level,
    timing: spell.castingTime,
    range: rangeToDraft(spell.range),
    concentration: Boolean(spell.concentration),
    ritual: Boolean(spell.ritual),
    resourceId: spell.resourceCost?.resourceId ?? "",
    upcastDamage: spell.upcast?.perSlotAboveBase?.damageDice ?? ""
  };
}

export function spellFromDraft(draft: BuilderDraft): SpellDefinition {
  const action = actionFromEffectDraft(draft, { spell: true });
  const resourceId = String(draft.resourceId ?? "").trim();
  const upcastDamage = String(draft.upcastDamage ?? "").trim();
  return {
    id: "",
    name: (draft.name as string) || "Spell",
    level: Math.max(0, Number(draft.level) || 0),
    castingTime: (draft.timing as "action" | "bonus" | "reaction") ?? "action",
    range: rangeToSpellRange(draft.range),
    concentration: draft.concentration ? true : undefined,
    ritual: draft.ritual ? true : undefined,
    resourceCost: resourceId ? { resourceId, amount: 1 } : undefined,
    upcast: upcastDamage ? { perSlotAboveBase: { damageDice: upcastDamage } } : undefined,
    action: { ...action, resourceCost: resourceId ? { resourceId, amount: 1 } : undefined },
    automationSupport: "full"
  };
}

function rangeToSpellRange(value: unknown): SpellDefinition["range"] {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "self") return "self";
  if (text === "touch") return "touch";
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n : 60;
}

/* ─── feature / trait ────────────────────────────────────────────────────── */

const FEATURE_SHAPE_OPTIONS = [
  { value: "passive", label: "A passive bonus (always on)" },
  { value: "activated", label: "Something you activate" },
  { value: "grants-bonus", label: "Grants a bonus-action option" }
] as const;

const ACTIVATE_AS_OPTIONS = [
  { value: "bonus", label: "Bonus action" },
  { value: "action", label: "Action" },
  { value: "reaction", label: "Reaction" },
  { value: "free", label: "Free (no economy cost)" }
] as const;

export function featureFieldSchema(draft: BuilderDraft): FieldSpec[] {
  const shape = (draft.featureShape as string) ?? "passive";
  return [
    { key: "name", copy: "name", control: "text" },
    { key: "category", copy: "feature.category", control: "select", options: [{ value: "feature", label: "Feature" }, { value: "trait", label: "Trait" }] },
    { key: "featureShape", copy: "feature.shape", control: "select", options: FEATURE_SHAPE_OPTIONS as unknown as FieldSpec["options"] },
    { key: "activateAs", copy: "feature.activateAs", control: "select", options: ACTIVATE_AS_OPTIONS as unknown as FieldSpec["options"], visibleWhen: () => shape === "activated" },
    { key: "durationRounds", copy: "feature.durationRounds", control: "number", min: 1, max: 100, advanced: true, visibleWhen: () => shape === "activated" },
    { key: "resourceId", copy: "feature.resourceId", control: "text", advanced: true, placeholder: "rage", visibleWhen: () => shape === "activated" },
    { key: "reactionTrigger", copy: "feature.reactionTrigger", control: "reaction-trigger", visibleWhen: (d) => shape === "activated" && d.activateAs === "reaction" },
    { key: "effects", copy: "feature.effects", control: "feature-effects", visibleWhen: () => shape === "passive" || shape === "activated" },
    { key: "auraEnabled", copy: "feature.auraEnabled", control: "toggle", advanced: true, visibleWhen: () => shape === "passive" },
    { key: "auraRange", copy: "feature.auraRange", control: "number", advanced: true, min: 5, step: 5,
      visibleWhen: () => shape === "passive" && Boolean(draft.auraEnabled) },
    { key: "auraAffects", copy: "feature.auraAffects", control: "select", advanced: true,
      options: [{ value: "allies", label: "Allies only" }, { value: "all", label: "Everyone in range" }, { value: "hostile", label: "Enemies only" }],
      visibleWhen: () => shape === "passive" && Boolean(draft.auraEnabled) },
    { key: "auraRequiresConscious", copy: "feature.auraRequiresConscious", control: "toggle", advanced: true,
      visibleWhen: () => shape === "passive" && Boolean(draft.auraEnabled) },
    { key: "grantsDash", copy: "feature.grantsDash", control: "toggle", visibleWhen: () => shape === "grants-bonus" },
    { key: "grantsDisengage", copy: "feature.grantsDisengage", control: "toggle", visibleWhen: () => shape === "grants-bonus" },
    { key: "grantsHide", copy: "feature.grantsHide", control: "toggle", visibleWhen: () => shape === "grants-bonus" },
    { key: "description", copy: "feature.description", control: "text" }
  ];
}

/** Effects applied once, at activation time — they belong on the feature, not the lingering condition. */
function isInstantEffect(effect: FeatureEffect): boolean {
  return effect.kind === "extra-action" || (effect.kind === "resource-regain" && effect.timing === "on-activate");
}

export function featureDraftFromDefinition(feature: FeatureDefinition): BuilderDraft {
  const granted = feature.grantedActions ?? [];
  const activate = granted.find((action) => action.kind === "activate-feature") as Extract<ActionDefinition, { kind: "activate-feature" }> | undefined;
  const grantedUtilities = granted.filter((action) => action.kind === "utility");
  const shape = activate ? "activated" : grantedUtilities.length > 0 ? "grants-bonus" : "passive";
  const legacyIncoming = activate?.condition?.modifiers?.incomingAttackRoll;
  const effects: FeatureEffect[] = [
    ...(feature.effects ?? []),
    ...(activate?.condition?.effects ?? []),
    ...(legacyIncoming ? [{ kind: "incoming-attack-modifier" as const, condition: "always" as const, amount: legacyIncoming }] : [])
  ];
  return {
    name: feature.name,
    category: feature.category === "trait" ? "trait" : "feature",
    featureShape: shape,
    effects,
    activateAs: activate?.actionType ?? "bonus",
    durationRounds: activate?.condition?.durationRounds ?? undefined,
    resourceId: activate?.resourceCost?.resourceId ?? "",
    reactionTrigger: activate?.reaction?.trigger,
    auraEnabled: Boolean(feature.aura),
    auraRange: feature.aura?.range ?? 10,
    auraAffects: feature.aura?.affects ?? "allies",
    auraRequiresConscious: feature.aura?.requiresConscious !== false,
    grantsDash: grantedUtilities.some((action) => action.kind === "utility" && action.mode === "dash"),
    grantsDisengage: grantedUtilities.some((action) => action.kind === "utility" && action.mode === "disengage"),
    grantsHide: grantedUtilities.some((action) => action.kind === "utility" && action.mode === "hide"),
    description: feature.description ?? ""
  };
}

export function featureFromDraft(draft: BuilderDraft): FeatureDefinition {
  const name = (draft.name as string) || "Feature";
  const category: FeatureDefinition["category"] = draft.category === "trait" ? "trait" : "feature";
  const shape = (draft.featureShape as string) ?? "passive";
  const allEffects = ((draft.effects as FeatureEffect[]) ?? []).filter(Boolean);
  const description = String(draft.description ?? "").trim() || undefined;

  if (shape === "grants-bonus") {
    const modes: Array<{ key: "grantsDash" | "grantsDisengage" | "grantsHide"; mode: "dash" | "disengage" | "hide"; support: "full" | "partial" }> = [
      { key: "grantsDash", mode: "dash", support: "full" },
      { key: "grantsDisengage", mode: "disengage", support: "full" },
      { key: "grantsHide", mode: "hide", support: "partial" }
    ];
    const grantedActions = modes.filter((m) => draft[m.key]).map((m) => ({
      kind: "utility" as const, id: `grant-${m.mode}`, name: `${name}: ${m.mode[0]!.toUpperCase()}${m.mode.slice(1)}`,
      actionType: "bonus" as const, mode: m.mode, automationSupport: m.support
    }));
    return { id: "", name, category, description, grantedActions: grantedActions.length ? grantedActions : undefined, automationSupport: "full" };
  }

  const instant = allEffects.filter(isInstantEffect);
  const lingering = allEffects.filter((effect) => !isInstantEffect(effect));

  if (shape === "activated") {
    const activateAs = (draft.activateAs as "action" | "bonus" | "reaction" | "free") ?? "bonus";
    const resourceId = String(draft.resourceId ?? "").trim();
    const rounds = Number(draft.durationRounds);
    const activate: Extract<ActionDefinition, { kind: "activate-feature" }> = {
      kind: "activate-feature", id: "activate", name,
      actionType: activateAs,
      featureId: "",
      resourceCost: resourceId ? { resourceId, amount: 1 } : undefined,
      reaction: activateAs === "reaction" ? reactionMetaFromDraft({ ...draft, activateAs }) : undefined,
      condition: (lingering.length || (Number.isFinite(rounds) && rounds > 0))
        ? {
          id: `${name.toLowerCase().replace(/\s+/g, "-")}-active`,
          name: "custom",
          durationRounds: Number.isFinite(rounds) && rounds > 0 ? Math.floor(rounds) : undefined,
          effects: lingering.length ? lingering : undefined
        }
        : undefined,
      automationSupport: "full"
    };
    return {
      id: "", name, category, description,
      effects: instant.length ? instant : undefined,
      grantedActions: [activate],
      automationSupport: "full"
    };
  }

  // passive
  const aura = draft.auraEnabled
    ? {
      range: Math.max(5, Number(draft.auraRange) || 10),
      affects: (draft.auraAffects as "allies" | "all" | "hostile") ?? "allies",
      requiresConscious: draft.auraRequiresConscious === false ? false : undefined
    }
    : undefined;
  return {
    id: "", name, category, description,
    effects: allEffects.length ? allEffects : undefined,
    aura,
    automationSupport: allEffects.length ? "full" : "manual-only"
  };
}

/* ─── preset skeletons ───────────────────────────────────────────────────── */

export type BuilderKind = "weapon" | "spell" | "deathEffect" | "action" | "feature";

export interface PresetSkeleton {
  kind: BuilderKind;
  label: string;
  draft: BuilderDraft;
}

export const PRESETS: PresetSkeleton[] = [
  { kind: "weapon", label: "Melee weapon", draft: weaponDraftFromDefinition({ id: "", name: "New Weapon", attackType: "melee", ability: "str", range: 5, reach: 5, damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }] }) },
  { kind: "weapon", label: "Ranged weapon", draft: weaponDraftFromDefinition({ id: "", name: "New Weapon", attackType: "ranged", ability: "dex", range: 80, longRange: 320, damage: [{ dice: "1d8", damageType: "piercing", abilityModifier: "dex" }] }) },
  { kind: "weapon", label: "Weapon with a rider", draft: weaponDraftFromDefinition({ id: "", name: "New Weapon", attackType: "melee", ability: "str", range: 5, reach: 5, damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }], onHit: [{ kind: "condition", when: "on-hit", condition: "frightened", save: { ability: "wis", onSuccess: "negates" }, duration: { kind: "rounds", rounds: 10 } }] }) },
  { kind: "spell", label: "Damage cantrip", draft: { ...spellDraftFromDefinition({ id: "", name: "New Cantrip", level: 0, castingTime: "action", range: 120, automationSupport: "full", action: { kind: "attack", id: "", name: "New Cantrip", actionType: "action", attackType: "spell", ability: "int", range: 120, damage: [{ dice: "1d10", damageType: "fire", magical: true }], automationSupport: "full" } }) } },
  { kind: "spell", label: "Save-or-condition spell", draft: { ...spellDraftFromDefinition({ id: "", name: "New Spell", level: 2, castingTime: "action", range: 60, concentration: true, automationSupport: "full", action: { kind: "save", id: "", name: "New Spell", actionType: "action", saveAbility: "wis", range: 60, damage: [], halfDamageOnSuccess: false, onSuccess: "negates", riders: [{ kind: "condition", when: "on-save-fail", condition: "paralyzed", duration: { kind: "save-ends", saveAt: "turn-end" }, save: { ability: "wis", onSuccess: "negates" } }], automationSupport: "full" } }) } },
  { kind: "spell", label: "Area blast", draft: { ...spellDraftFromDefinition({ id: "", name: "New Spell", level: 3, castingTime: "action", range: 150, automationSupport: "full", action: { kind: "area-save", id: "", name: "New Spell", actionType: "action", saveAbility: "dex", range: 150, area: { type: "circle", size: 20 }, targeting: { origin: "point", range: 150 }, damage: [{ dice: "8d6", damageType: "fire", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all", automationSupport: "full" } }) } },
  { kind: "spell", label: "Healing", draft: { ...spellDraftFromDefinition({ id: "", name: "New Spell", level: 1, castingTime: "action", range: "touch", automationSupport: "full", action: { kind: "healing", id: "", name: "New Spell", actionType: "action", range: 5, healing: [{ dice: "1d8", abilityModifier: "wis" }], targeting: { target: "single" }, automationSupport: "full" } }) } },
  { kind: "spell", label: "Reaction spell (Shield / Rebuke)", draft: { ...spellDraftFromDefinition({ id: "", name: "New Reaction", level: 1, castingTime: "reaction", range: 60, automationSupport: "full", action: { kind: "save", id: "", name: "New Reaction", actionType: "reaction", saveAbility: "dex", range: 60, damage: [{ dice: "2d10", damageType: "fire", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", reaction: { trigger: { kind: "hit-by-attack" }, target: "trigger-source", priority: "worthwhile" }, automationSupport: "full" } }) } },
  {
    kind: "deathEffect", label: "Death explosion (Gas Spore-style)",
    draft: deathEffectDraftFromDefinition({
      id: "", name: "Death Burst",
      description: "When this creature dies, it explodes.",
      action: {
        kind: "area-save", id: "", name: "Death Burst", actionType: "action",
        saveAbility: "con", dc: 8, range: 0,
        area: { type: "circle", size: 10 },
        targeting: { origin: "self", range: 0 },
        damage: [{ dice: "3d6", damageType: "poison" }],
        halfDamageOnSuccess: false, onSuccess: "negates", affects: "all",
        riders: [{
          kind: "condition", when: "on-save-fail", condition: "poisoned",
          duration: { kind: "rounds", rounds: 10 },
          save: { ability: "con", onSuccess: "negates" }
        }],
        automationSupport: "full"
      },
      automationSupport: "full"
    })
  },
  {
    kind: "feature", label: "Rage",
    draft: {
      name: "Rage", category: "feature", featureShape: "activated", activateAs: "bonus", resourceId: "rage", durationRounds: 10,
      description: "Advantage on STR checks / saves, +2 melee damage, resistance to b / p / s.",
      effects: [
        { kind: "damage-bonus", condition: "always", attackTypes: ["melee"], abilities: ["str"], damage: [{ dice: "2", damageType: "same-as-attack" }] },
        { kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType: "bludgeoning" } },
        { kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType: "piercing" } },
        { kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType: "slashing" } },
        { kind: "save-advantage", ability: "str" }
      ]
    }
  },
  {
    kind: "feature", label: "Reckless Attack",
    draft: {
      name: "Reckless Attack", category: "feature", featureShape: "activated", activateAs: "free", durationRounds: 1,
      effects: [
        { kind: "attack-advantage", condition: "always", attackTypes: ["melee"], mode: "advantage" },
        { kind: "incoming-attack-modifier", condition: "always", amount: 5 }
      ]
    }
  },
  {
    kind: "feature", label: "Action Surge",
    draft: {
      name: "Action Surge", category: "feature", featureShape: "activated", activateAs: "free", resourceId: "action-surge",
      effects: [{ kind: "extra-action", condition: "always", slot: "action" }]
    }
  },
  { kind: "feature", label: "Cunning Action", draft: { name: "Cunning Action", category: "feature", featureShape: "grants-bonus", grantsDash: true, grantsDisengage: true, grantsHide: true } },
  {
    kind: "feature", label: "Pack Tactics",
    draft: { name: "Pack Tactics", category: "trait", featureShape: "passive", effects: [{ kind: "attack-advantage", condition: "ally-adjacent-to-target" }] }
  },
  {
    kind: "feature", label: "Sneak Attack",
    draft: {
      name: "Sneak Attack", category: "feature", featureShape: "passive",
      effects: [{ kind: "damage-bonus", oncePerTurn: true, condition: "always", anyConditions: ["attack-has-advantage", "ally-adjacent-to-target"], attackTypes: ["melee", "ranged"], damage: [{ dice: "3d6", damageType: "same-as-attack" }] }]
    }
  }
];
