/**
 * The ability editor's sections (plan §3.3): which appear for a record, and the one-line summary each shows while
 * collapsed ("Action · Recharge 5–6", "60-ft cone · everyone in it", "Dexterity save · DC 21 (as printed) · half").
 * What kind of ability it is follows from its Roll and Target, so there's no separate "what it does" section.
 */
import {
  getExecutableActions,
  resolveAttackBonus,
  resolveSaveDc,
  type ActionDefinition,
  type CreatureDefinition,
  type DeathEffectDefinition,
  type FeatureDefinition,
  type LegendaryActionRef,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import {
  areaShort,
  compiledWeaponAttack,
  costText,
  damageShort,
  effectShorts,
  emanationShort,
  modifierShorts,
  riderShort,
  roundsText,
  triggerText,
  usageLabel
} from "@/lib/statblock";
import { actionLimit, actionTarget, attackBonusBinding, saveDcBinding, type Limit } from "./bindings";
import type { AbilityRecord, AbilityRef } from "./refs";

export type SectionId =
  | "basics"
  | "use"
  | "target"
  | "roll"
  | "damage"
  | "effects"
  | "while-active"
  | "aura"
  | "lingering"
  | "sequence"
  | "grants"
  | "notes";

export interface SectionContext {
  ref: AbilityRef;
  record: AbilityRecord;
  definition: CreatureDefinition;
}

export interface SectionSummary {
  id: SectionId;
  title: string;
  summary: string;
}

/* ─── what the record is ─────────────────────────────────────────────────── */

type Shape =
  | { type: "weapon"; weapon: WeaponDefinition; action?: ActionDefinition }
  | { type: "spell"; spell: SpellDefinition; action?: ActionDefinition }
  | { type: "feature"; feature: FeatureDefinition }
  | { type: "death"; effect: DeathEffectDefinition; action: ActionDefinition }
  | { type: "legendary"; entry: LegendaryActionRef; action?: ActionDefinition }
  | { type: "action"; action: ActionDefinition };

/** The record by what it is, with the action that does its work (a weapon's compiled attack, a spell's action …). */
function shapeOf({ ref, record, definition }: SectionContext): Shape {
  switch (ref.list) {
    case "weapons": {
      const weapon = record as WeaponDefinition;
      const action = compiledWeaponAttack(weapon, definition);
      return { type: "weapon", weapon, action: action ? { ...action, riders: weapon.onHit } as ActionDefinition : undefined };
    }
    case "spells": {
      const spell = record as SpellDefinition;
      return { type: "spell", spell, action: spell.action };
    }
    case "features":
    case "traits":
      return { type: "feature", feature: record as FeatureDefinition };
    case "deathEffects": {
      const effect = record as DeathEffectDefinition;
      return { type: "death", effect, action: effect.action };
    }
    case "legendary": {
      const entry = record as LegendaryActionRef;
      return { type: "legendary", entry, action: entry.action };
    }
    default:
      return { type: "action", action: record as ActionDefinition };
  }
}

const actionOf = (shape: Shape): ActionDefinition | undefined => ("action" in shape ? shape.action : undefined);

const DAMAGE_KINDS = new Set<ActionDefinition["kind"]>(["attack", "save", "area-save"]);
const RIDER_KINDS = new Set<ActionDefinition["kind"]>(["attack", "save", "area-save", "healing"]);

/** A feature's activation, if it has one (Rage, Action Surge). */
const activationOf = (feature: FeatureDefinition) => feature.grantedActions?.find((action) => action.kind === "activate-feature");

/* ─── summaries ──────────────────────────────────────────────────────────── */

const SLOT_WORDS: Record<ActionDefinition["actionType"], string> = {
  action: "Action", bonus: "Bonus action", reaction: "Reaction", free: "Free"
};

function limitText(limit: Limit, action: ActionDefinition): string {
  switch (limit.kind) {
    case "at-will": return "at will";
    case "slot": return costText({ resourceId: `slot-${limit.level}`, amount: 1 });
    case "pool": return costText({ resourceId: limit.resourceId, amount: limit.amount });
    case "uses":
    case "recharge": return usageLabel("usage" in action ? action.usage : undefined);
  }
}

function useSummary(shape: Shape): string {
  if (shape.type === "feature") {
    const activation = activationOf(shape.feature);
    if (!activation) return "always on";
    return [SLOT_WORDS[activation.actionType], limitText(actionLimit.get(activation), activation)].join(" · ");
  }
  if (shape.type === "legendary") return `costs ${shape.entry.cost} legendary ${shape.entry.cost === 1 ? "action" : "actions"}`;
  if (shape.type === "weapon") {
    const { weapon } = shape;
    const slots = (weapon.usableAs ?? ["action"]).filter((slot) => slot !== "reaction");
    const charges = weapon.charges
      ? `${weapon.charges.max} ${weapon.charges.max === 1 ? "charge" : "charges"}${typeof weapon.charges.recharge === "string" ? `, refills ${weapon.charges.recharge === "dawn" ? "at dawn" : `on a ${weapon.charges.recharge.replace("-", " ")}`}` : ""}`
      : "";
    const noOpportunity = weapon.attackType === "melee" && weapon.usableAs && !weapon.usableAs.includes("reaction") ? "no opportunity attacks" : "";
    return [slots.map((slot) => SLOT_WORDS[slot]).join(" or "), charges, noOpportunity].filter(Boolean).join(" · ");
  }
  const action = actionOf(shape);
  if (!action) return "—";
  const reaction = "reaction" in action && action.actionType === "reaction" && action.reaction ? `when ${triggerText(action.reaction.trigger)}` : "";
  return [SLOT_WORDS[action.actionType], reaction, limitText(actionLimit.get(action), action)].filter(Boolean).join(" · ");
}

function targetSummary(action: ActionDefinition): string {
  const target = actionTarget.get(action);
  if (!target) return "—";
  switch (target.kind) {
    case "self": return "itself";
    case "creature":
      if (action.kind === "attack") return action.attackType === "melee" ? `reach ${target.range} ft` : `range ${target.range}${target.longRange ? `/${target.longRange}` : ""} ft`;
      return `one creature within ${target.range} ft`;
    case "creatures": return `up to ${target.count} creatures within ${target.range} ft`;
    case "area": {
      const who = action.kind === "area-save" && action.affects === "hostile" ? "enemies in it" : action.kind === "healing" ? "allies in it" : "everyone in it";
      return action.kind === "area-save" ? `${areaShort(action)} · ${who}` : `${target.area.size}-ft ${target.area.type} · ${who}`;
    }
  }
}

const ABILITY_WORD = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" } as const;

function rollSummary(action: ActionDefinition, definition: CreatureDefinition): string {
  if (action.kind === "attack") {
    const bonus = resolveAttackBonus(action, definition);
    const how = attackBonusBinding.get(action).mode === "printed" ? "as printed" : "calculated";
    const kind = action.attackType === "melee" ? "Melee attack" : action.attackType === "ranged" ? "Ranged attack" : "Spell attack";
    return action.autoHit ? `${kind} · hits automatically` : `${kind} · ${bonus < 0 ? bonus : `+${bonus}`} (${how})`;
  }
  if (action.kind === "save" || action.kind === "area-save") {
    const how = saveDcBinding.get(action).mode === "printed" ? "as printed" : "calculated";
    const onSuccess = action.onSuccess ?? (action.halfDamageOnSuccess ? "half" : "none");
    const success = onSuccess === "half" ? "half on a success" : onSuccess === "negates" ? "a success negates it" : "nothing on a success";
    return `${ABILITY_WORD[action.saveAbility]} save · DC ${resolveSaveDc(action, definition)} (${how}) · ${success}`;
  }
  return "—";
}

function damageSummary(action: ActionDefinition, definition: CreatureDefinition): string {
  if (!("damage" in action) || !action.damage.length) return "none";
  return damageShort(action.damage, definition);
}

function effectsSummary(action: ActionDefinition, definition: CreatureDefinition): string {
  const riders = "riders" in action ? action.riders ?? [] : [];
  if (!riders.length) return "none";
  const rollsOwnSave = action.kind === "attack";
  const fallbackDc = action.kind === "save" || action.kind === "area-save" ? resolveSaveDc(action, definition) : 10;
  const shorts = riders.map((rider) => rider.kind === "note" ? "note" : riderShort(rider, definition, fallbackDc, rollsOwnSave)).filter(Boolean);
  return shorts.join(", ") || "none";
}

function lingeringSummary(action: ActionDefinition): string {
  if (action.kind !== "area-save" || !action.zone) return "off";
  const { zone } = action;
  const lasts = zone.duration.kind === "rounds" ? roundsText(zone.duration.rounds) : zone.duration.kind === "concentration" ? "while concentrating" : "until the fight ends";
  const extras = [
    zone.trigger.length ? `${zone.trigger.length} ${zone.trigger.length === 1 ? "trigger" : "triggers"}` : "no triggers",
    zone.anchor === "self" ? "follows it" : "",
    zone.movement ? `drifts ${zone.movement.driftFeetPerCasterTurn} ft` : "",
    zone.terrain ? `${zone.terrain.type} terrain` : ""
  ].filter(Boolean);
  return [lasts, ...extras].join(" · ");
}

function sequenceSummary(action: ActionDefinition, definition: CreatureDefinition): string {
  if (action.kind !== "multiattack") return "—";
  const names = new Map(getExecutableActions(definition).map((candidate) => [candidate.id, candidate.name]));
  return action.attacks.map((step) => `${step.count > 1 ? `${step.count} × ` : ""}${names.get(step.actionId) ?? "(missing)"}`).join(", ") || "no steps";
}

function whileActiveSummary(shape: Shape, definition: CreatureDefinition): string {
  if (shape.type === "feature") {
    const activation = activationOf(shape.feature);
    const effects = [
      ...(activation?.kind === "activate-feature" ? [...modifierShorts(activation.condition?.modifiers), ...effectShorts(activation.condition?.effects, definition)] : []),
      ...effectShorts(shape.feature.effects, definition)
    ];
    return effects.join(", ") || "none";
  }
  if (shape.type === "weapon") return effectShorts(shape.weapon.effects, definition).join(", ") || "none";
  return "none";
}

function auraSummary(feature: FeatureDefinition, definition: CreatureDefinition): string {
  const parts = [
    feature.aura ? `helps ${feature.aura.affects === "allies" ? "allies" : feature.aura.affects === "hostile" ? "enemies" : "everyone"} within ${feature.aura.range} ft` : "",
    feature.emanation ? emanationShort(feature.emanation, definition) : ""
  ].filter(Boolean);
  return parts.join(" · ") || "off";
}

function grantsSummary(shape: Shape): string {
  const granted = shape.type === "weapon" ? shape.weapon.grantedActions ?? [] : shape.type === "feature" ? shape.feature.grantedActions ?? [] : [];
  const shown = granted.filter((action) => action.kind !== "activate-feature");
  const max = shape.type === "weapon" ? shape.weapon.charges?.max : undefined;
  const charges = max ? `${max} ${max === 1 ? "charge" : "charges"}` : "";
  return [shown.map((action) => action.name).join(", "), charges].filter(Boolean).join(" · ") || "none";
}

function notesSummary(shape: Shape): string {
  const support = shape.type === "weapon" ? "full"
    : shape.type === "spell" ? shape.spell.automationSupport
      : shape.type === "feature" ? (shape.feature.informational ? "informational" : shape.feature.automationSupport)
        : shape.type === "death" ? shape.effect.automationSupport
          // A legendary action that borrows one of the creature's actions is simulated through it.
          : shape.type === "legendary" && !shape.action ? (shape.entry.actionId ? "full" : "manual-only")
          : actionOf(shape)?.automationSupport ?? "manual-only";
  // A note among its effects is shown to the DM, not applied: partly simulated, as the preview says.
  const riders = shape.type === "weapon" ? shape.weapon.onHit : (actionOf(shape) as { riders?: Array<{ kind: string }> } | undefined)?.riders;
  const noted = support === "full" && Boolean(riders?.some((rider) => rider.kind === "note"));
  const label = noted ? "partly simulated" : support === "full" ? "simulated" : support === "partial" ? "partly simulated" : support === "informational" ? "no combat effect" : "reference only";
  const hasText = shape.type === "spell" ? Boolean(shape.spell.description)
    : shape.type === "feature" ? Boolean(shape.feature.description)
      : shape.type === "legendary" ? Boolean(shape.entry.description)
        : shape.type === "death" ? Boolean(shape.effect.description)
          : shape.type === "weapon" ? Boolean(shape.weapon.description)
            : Boolean(actionOf(shape)?.description);
  return [hasText ? "reference text" : "", label].filter(Boolean).join(" · ");
}

function basicsSummary(shape: Shape): string {
  switch (shape.type) {
    case "weapon": return `${shape.weapon.name} · ${shape.weapon.attackType === "focus" ? "focus" : `${shape.weapon.category ? `${shape.weapon.category} ` : ""}${shape.weapon.attackType} weapon`}`;
    case "spell": return `${shape.spell.name} · ${shape.spell.level === 0 ? "cantrip" : `level ${shape.spell.level}`}${shape.spell.school ? ` ${shape.spell.school}` : ""}${shape.spell.concentration ? " · concentration" : ""}`;
    case "feature": return `${shape.feature.name} · ${shape.feature.category}${shape.feature.optional ? " · optional" : ""}`;
    case "death": return `${shape.effect.name} · on death`;
    case "legendary": return `${shape.entry.name} · legendary action`;
    case "action": return `${shape.action.name} · ${KIND_WORDS[shape.action.kind]}`;
  }
}

const KIND_WORDS: Record<ActionDefinition["kind"], string> = {
  attack: "attack", save: "saving throw", "area-save": "area", healing: "heal", buff: "buff", reposition: "teleport",
  multiattack: "multiattack", summon: "summon", transform: "shapechange", utility: "standard action",
  "activate-feature": "activation", unsupported: "reference only"
};

/* ─── the registry ───────────────────────────────────────────────────────── */

interface SectionSpec {
  id: SectionId;
  title: string;
  appliesTo(shape: Shape): boolean;
  summary(shape: Shape, definition: CreatureDefinition): string;
}

const withAction = (test: (action: ActionDefinition) => boolean) => (shape: Shape) => {
  const action = actionOf(shape);
  return Boolean(action && test(action));
};

const SECTIONS: SectionSpec[] = [
  { id: "basics", title: "Basics", appliesTo: () => true, summary: (shape) => basicsSummary(shape) },
  {
    id: "use",
    title: "Use & cost",
    // Everything but a passive trait, which isn't used at all; and a death effect, which fires on its own.
    appliesTo: (shape) => shape.type === "feature" ? Boolean(activationOf(shape.feature)) : shape.type !== "death",
    summary: (shape) => useSummary(shape)
  },
  { id: "target", title: "Target", appliesTo: withAction((action) => actionTarget.get(action) !== undefined), summary: (shape) => targetSummary(actionOf(shape)!) },
  { id: "roll", title: "Roll", appliesTo: withAction((action) => action.kind === "attack" || action.kind === "save" || action.kind === "area-save"), summary: (shape, definition) => rollSummary(actionOf(shape)!, definition) },
  { id: "damage", title: "Damage", appliesTo: withAction((action) => DAMAGE_KINDS.has(action.kind)), summary: (shape, definition) => damageSummary(actionOf(shape)!, definition) },
  { id: "effects", title: "Effects", appliesTo: withAction((action) => RIDER_KINDS.has(action.kind)), summary: (shape, definition) => effectsSummary(actionOf(shape)!, definition) },
  {
    id: "while-active",
    title: "While active",
    appliesTo: (shape) => shape.type === "feature" || shape.type === "weapon",
    summary: (shape, definition) => whileActiveSummary(shape, definition)
  },
  { id: "aura", title: "Aura", appliesTo: (shape) => shape.type === "feature", summary: (shape, definition) => auraSummary((shape as Extract<Shape, { type: "feature" }>).feature, definition) },
  { id: "lingering", title: "Lingering area", appliesTo: withAction((action) => action.kind === "area-save"), summary: (shape) => lingeringSummary(actionOf(shape)!) },
  { id: "sequence", title: "Sequence", appliesTo: withAction((action) => action.kind === "multiattack"), summary: (shape, definition) => sequenceSummary(actionOf(shape)!, definition) },
  { id: "grants", title: "Grants", appliesTo: (shape) => shape.type === "weapon" || shape.type === "feature", summary: (shape) => grantsSummary(shape) },
  { id: "notes", title: "Notes & AI", appliesTo: () => true, summary: (shape) => notesSummary(shape) }
];

/** The sections the editor shows for a record, in order, each with its collapsed summary. */
export function sectionsFor(context: SectionContext): SectionSummary[] {
  const shape = shapeOf(context);
  return SECTIONS.filter((section) => section.appliesTo(shape)).map((section) => ({
    id: section.id,
    title: section.title,
    summary: section.summary(shape, context.definition)
  }));
}

/** Whether a section appears for a record. */
export function sectionApplies(context: SectionContext, id: SectionId): boolean {
  const section = SECTIONS.find((candidate) => candidate.id === id);
  return Boolean(section?.appliesTo(shapeOf(context)));
}
