/**
 * Field schemas + draft <-> definition converters for the three guided builders.
 * Pure functions only (no JSX) so `builder-fields.test.tsx` can exercise the
 * progressive-disclosure logic directly.
 */
import type {
  Ability,
  ActionDefinition,
  ActionRider,
  AreaTemplate,
  DamageComponent,
  FeatureDefinition,
  FeatureEffect,
  ReactionMeta,
  ReactionTrigger,
  SpellDefinition,
  WeaponDefinition
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
  { value: "healing", label: "Healing" }
] as const;

const AREA_OPTIONS = [
  { value: "circle", label: "Circle" }, { value: "cone", label: "Cone" },
  { value: "line", label: "Line" }, { value: "rectangle", label: "Rectangle" }, { value: "square", label: "Square" }
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

    { key: "saveAbility", copy: "spell.saveAbility", control: "ability", visibleWhen: () => inSaveShape },
    { key: "saveDc", copy: "spell.saveDc", control: "number", advanced: true, visibleWhen: () => inSaveShape },
    { key: "onSuccess", copy: "spell.onSuccess", control: "select", options: ON_SUCCESS_OPTIONS as unknown as FieldSpec["options"], visibleWhen: () => inSaveShape },

    { key: "areaType", copy: "area.type", control: "select", options: AREA_OPTIONS as unknown as FieldSpec["options"], visibleWhen: () => shape === "area" },
    { key: "areaSize", copy: "area.size", control: "number", min: 5, step: 5, visibleWhen: () => shape === "area" },
    { key: "areaWidth", copy: "area.width", control: "number", min: 5, step: 5, visibleWhen: () => shape === "area" && (areaType === "line" || areaType === "rectangle") },
    { key: "areaOrigin", copy: "area.origin", control: "select", options: [{ value: "point", label: "A point you choose" }, { value: "self", label: "The caster" }], visibleWhen: () => shape === "area" },
    { key: "areaAimed", copy: "area.aimedFromSelf", control: "toggle", visibleWhen: () => shape === "area" && (areaType === "cone" || areaType === "line" || areaType === "rectangle") },
    { key: "affects", copy: "area.affects", control: "select", advanced: true, options: [{ value: "hostile", label: "Enemies only" }, { value: "all", label: "Everyone in the area" }], visibleWhen: () => shape === "area" },

    { key: "dealsDamage", copy: "spell.dealsDamage", control: "toggle", visibleWhen: () => shape === "save" || shape === "area" },
    { key: "dmg", copy: "spell.damage", control: "dice", visibleWhen: () => inDamageShape && (shape === "attack" || Boolean(draft.dealsDamage)) },

    { key: "healDice", copy: "spell.healDice", control: "dice", visibleWhen: () => shape === "healing" },
    { key: "healTarget", copy: "spell.healTarget", control: "select", options: [{ value: "single", label: "One creature" }, { value: "self", label: "The caster" }], visibleWhen: () => shape === "healing" },

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
    { key: "range", copy: "spell.range", control: "text", placeholder: "60" },
    ...effectShapeSpecs(draft),
    { key: "concentration", copy: "spell.concentration", control: "toggle", advanced: true },
    { key: "ritual", copy: "spell.ritual", control: "toggle", advanced: true },
    { key: "resourceId", copy: "spell.resourceId", control: "text", advanced: true, placeholder: "slot-1" },
    { key: "upcastDamage", copy: "spell.upcastDamage", control: "text", advanced: true, placeholder: "1d6" }
  ];
}

/* ─── innate action ──────────────────────────────────────────────────────── */

export function actionFieldSchema(draft: BuilderDraft): FieldSpec[] {
  return [
    { key: "name", copy: "name", control: "text" },
    { key: "timing", copy: "timing", control: "select", options: TIMING_OPTIONS as unknown as FieldSpec["options"] },
    ...reactionBlockSpecs("spell.reactionTrigger", "spell.reactionTarget", "spell.reactionPriority", (d) => d.timing === "reaction"),
    { key: "range", copy: "spell.range", control: "text", placeholder: "5" },
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
    riders: [],
    concentration: false
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
        affects: action.affects === "all" ? "all" : undefined
      }
      : {};
    return {
      ...base,
      ...areaExtra,
      range: rangeToDraft(action.range),
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
      healTarget: action.targeting?.target ?? "single"
    };
  }
  return { ...base, range: "60" };
}

type BuildableAction = Extract<ActionDefinition, { kind: "attack" | "save" | "area-save" | "healing" }>;

/** Build an `ActionDefinition` skeleton from an effect draft (store normalization fills the rest). */
export function actionFromEffectDraft(draft: BuilderDraft, options: { spell?: boolean } = {}): BuildableAction {
  const shape = draft.shape as string;
  const name = (draft.name as string) || "Ability";
  const actionType = (draft.timing as "action" | "bonus" | "reaction") ?? "action";
  const range = draftRangeToNumber(draft.range);
  const riders = ((draft.riders as ActionRider[]) ?? []).filter(Boolean);
  const dmg = diceToComponent(draft.dmg as DiceValue, "int");
  const dcValue = Number(draft.saveDc);
  const dcFormula = options.spell ? { base: 8, ability: (draft.saveAbility as Ability) ?? "int", proficiency: true } : { base: 8, proficiency: true };
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
    return {
      kind: "healing", id: "", name, actionType, range,
      healing: [{ dice: diceValueToString(draft.healDice as DiceValue), abilityModifier: (draft.healDice as DiceValue)?.addAbility ? "wis" : undefined }],
      targeting: draft.healTarget === "self" ? { target: "self" } : { target: "single" },
      automationSupport: "full"
    };
  }
  const onSuccess = (draft.onSuccess as "half" | "none" | "negates") ?? "half";
  const damage = draft.dealsDamage === false ? [] : [dmg];
  if (shape === "area") {
    const area: AreaTemplate = {
      type: (draft.areaType as AreaTemplate["type"]) ?? "circle",
      size: Math.max(5, Number(draft.areaSize) || 20),
      width: (draft.areaType === "line" || draft.areaType === "rectangle") ? Math.max(5, Number(draft.areaWidth) || 5) : undefined
    };
    return {
      kind: "area-save", id: "", name, actionType, range, reaction,
      saveAbility: (draft.saveAbility as Ability) ?? "dex",
      dc: Number.isFinite(dcValue) && dcValue > 0 ? dcValue : undefined,
      dcFormula: Number.isFinite(dcValue) && dcValue > 0 ? undefined : dcFormula,
      area,
      targeting: { origin: draft.areaOrigin === "self" ? "self" : "point", aimedFromSelf: draft.areaAimed ? true : undefined, range },
      damage,
      halfDamageOnSuccess: onSuccess === "half",
      onSuccess,
      affects: draft.affects === "all" ? "all" : "hostile",
      riders: riders.length ? riders : undefined,
      concentration: draft.concentration ? true : undefined,
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
  return {
    id: "", name, category, description,
    effects: allEffects.length ? allEffects : undefined,
    automationSupport: allEffects.length ? "full" : "manual-only"
  };
}

/* ─── preset skeletons ───────────────────────────────────────────────────── */

export type BuilderKind = "weapon" | "spell" | "action" | "feature";

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
