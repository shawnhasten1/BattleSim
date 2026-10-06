/**
 * The hotbar on a person's creature's turn in Play (PLAY_MODE_PLAN.md §2.2, §3.7): everything it can use, by tab, one
 * button per ability with its variants folded in (the slot to cast at, Power Attack, spend a charge, a multiattack's
 * other routines), what each costs, whether the engine runs it, how it's aimed, and — greyed out — why it can't be used
 * now, in the words the engine refuses with. Pure: the Hotbar shows it, tests read it.
 */
import {
  actionProblem,
  BASE_FORM_ID,
  OPPORTUNITY_ATTACKS,
  casterLevelOf,
  getDefinition,
  getExecutableActions,
  isLairVariant,
  isLegendaryVariant,
  isUpcastVariant,
  multiattackBaseId,
  repeatDice,
  spellSlotLevel,
  upcastAddsSomething,
  swingsOf,
  targetCapacity,
  zoneMoveProblem,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type EncounterSnapshot,
  type Id
} from "@/engine";
import { actionStatblock, costText, usageLabel } from "@/lib/statblock";

export type HotbarTab = "attacks" | "spells" | "bonus" | "features" | "items" | "common" | "reactions";

export const HOTBAR_TABS: ReadonlyArray<{ id: HotbarTab; label: string }> = [
  { id: "attacks", label: "Attacks" },
  { id: "spells", label: "Spells" },
  { id: "bonus", label: "Bonus" },
  { id: "features", label: "Features" },
  { id: "items", label: "Items" },
  { id: "common", label: "Common" },
  { id: "reactions", label: "Reactions" }
];

/** How an ability is aimed once it's armed. */
export type Aim =
  /** Used at once: on itself, or on nothing. */
  | { kind: "none" }
  /** Creatures, clicked on the map: up to `count` (more than one: Enter finishes); `repeat` lets one be picked again (rays, beams). */
  | { kind: "creatures"; who: "foes" | "allies"; count: number; repeat: boolean; range: number }
  /** A multiattack: its first target; each swing after it is asked for. */
  | { kind: "routine"; range: number }
  /** An area: where it's put (or, from itself, which way it's aimed). */
  | { kind: "area" }
  /** Where a teleport takes the user, or (`other`) first who it moves and then where. */
  | { kind: "place"; moves: "self" | "other" }
  /** Where a zone the creature controls moves to (Moonbeam), up to `maxFeet`. */
  | { kind: "zone"; zoneId: Id; maxFeet: number }
  /** One of a list: a creature to summon, a form to take. */
  | { kind: "option"; options: Array<{ id: Id; label: string }> };

export interface HotbarVariant {
  actionId: Id;
  /** "Level 3", "Power Attack", "Spend a charge", a routine's name. */
  label: string;
  /** What it spends: "a 3rd-level slot", "1 ki point", "Recharge 5–6". */
  cost?: string;
  /** Why it can't be used now. */
  problem?: string;
  aim: Aim;
  /** The spell slot level it spends. */
  slotLevel?: number;
  /** What it takes, when its button's variants differ (a potion drunk as a bonus action and given as an action). */
  slot?: "action" | "bonus" | "free";
}

export type Automation = "full" | "partial" | "by-hand";

export interface HotbarButton {
  /** The family's id: the plain ability its variants are copies of. */
  key: string;
  tab: HotbarTab;
  name: string;
  /** What using it takes. */
  slot: "action" | "bonus" | "free";
  variants: HotbarVariant[];
  /** The variant a click uses: the first that can be used now. */
  defaultVariant: number;
  /** The plain variant's cost. */
  cost?: string;
  /** "full": the engine runs it as written; "partial": only part of it; "by-hand": the DM applies it. */
  automation: Automation;
  /** Why none of its variants can be used now. */
  problem?: string;
  /** Its statblock entry, for the tooltip. */
  title: string;
  text: string;
  spellLevel?: number;
  concentration?: boolean;
  /** An item's: how many are left ("×2"), or its charges ("5 charges"). */
  count?: string;
}

/** One of the creature's reactions, as the Reactions tab lists it: its setting is `reactionPolicyKey(actorId, key)`. */
export interface HotbarReaction {
  /** `OPPORTUNITY_ATTACKS`, or the reaction's id. */
  key: string;
  name: string;
  /** When it's offered, and what it costs. */
  detail?: string;
}

export interface HotbarModel {
  actorId: Id;
  /** Its reactions, for the Reactions tab (they're asked for when they come up; the tab sets how). */
  reactions: HotbarReaction[];
  tabs: Array<{ id: HotbarTab; label: string; buttons: HotbarButton[] }>;
  /** Spell slots by level: what's left and the full count. */
  slots: Array<{ level: number; left: number; full: number }>;
  /** What the creature is concentrating on, if anything. */
  concentration?: string;
}

/**
 * Copies of an ability that change one thing about it: a power attack, spending a charge, a higher slot, giving a
 * potion, a wand's spell for more charges.
 */
const VARIANT_SUFFIX = /:(?:power|charged(?:-\d+)?|upcast-\d+|give|full|charges-\d+|meta-[a-z]+|overchannel)$/;

/** The plain ability a variant is a copy of: `longsword:power:charged` → `longsword`, `claws:option-2` → `claws`. */
export function familyKey(id: Id): Id {
  let key = multiattackBaseId(id);
  while (VARIANT_SUFFIX.test(key)) key = key.replace(VARIANT_SUFFIX, "");
  return key;
}

/** Abilities used by hand: the engine doesn't run them (reference text), or only logs them (Hide, Help). */
function automationOf(action: ActionDefinition): Automation {
  if (action.kind === "unsupported" || action.automationSupport === "manual-only" || action.automationSupport === "unsupported") return "by-hand";
  if (action.kind === "utility" && (action.mode === "hide" || action.mode === "help")) return "by-hand";
  return action.automationSupport === "partial" ? "partial" : "full";
}

/** Granted by a feature or a trait (Second Wind, Rage, Action Surge), as opposed to the creature's own actions. */
function featureGrantedIds(definition: CreatureDefinition): Set<Id> {
  const ids = new Set<Id>();
  for (const feature of [...(definition.features ?? []), ...(definition.traits ?? [])]) {
    for (const action of feature.grantedActions ?? []) ids.add(action.id);
  }
  return ids;
}

function tabOf(action: ActionDefinition, granted: Set<Id>): HotbarTab {
  if (action.item) return "items";
  if (action.kind === "utility") return "common";
  if ("spellLevel" in action && action.spellLevel != null) return "spells";
  if (action.kind === "attack" || action.kind === "multiattack") return action.actionType === "bonus" ? "bonus" : "attacks";
  if (action.kind === "activate-feature" || granted.has(familyKey(action.id))) return "features";
  if (action.actionType === "bonus") return "bonus";
  if (action.kind === "save" || action.kind === "area-save") return "attacks";
  return "features";
}

/** The attack's reach: a melee attack's reach, a ranged one's long range. */
function attackRange(action: Extract<ActionDefinition, { kind: "attack" }>): number {
  return action.attackType === "melee" ? action.reach ?? action.range : action.longRange ?? action.range;
}

function aimOf(action: ActionDefinition, definition: CreatureDefinition, executables: ActionDefinition[], actor: CombatantState): Aim {
  const casterLevel = casterLevelOf(definition);
  switch (action.kind) {
    case "attack": {
      const count = targetCapacity(action, casterLevel);
      return { kind: "creatures", who: "foes", count, repeat: count > 1, range: attackRange(action) };
    }
    case "multiattack": {
      const reaches = swingsOf(action.attacks).flatMap((swing) => {
        const named = swing.step.actionId ? executables.find((candidate) => candidate.id === swing.step.actionId) : undefined;
        if (named?.kind === "attack") return [attackRange(named)];
        if (named && "range" in named) return [named.range];
        // A generic step ("any melee attack"): the reach of what it could swing with.
        return executables.filter((candidate): candidate is Extract<ActionDefinition, { kind: "attack" }> => candidate.kind === "attack" && candidate.actionType === "action")
          .filter((candidate) => swing.step.any === "weapon" ? candidate.attackType !== "spell" : candidate.attackType === swing.step.any)
          .map(attackRange);
      });
      return { kind: "routine", range: Math.max(5, ...reaches) };
    }
    case "save":
      return action.targeting?.target === "self"
        ? { kind: "none" }
        : { kind: "creatures", who: "foes", count: targetCapacity(action, casterLevel), repeat: false, range: action.range };
    case "area-save":
      // Even one centred on itself is shown before it's cast: who it catches.
      return { kind: "area" };
    case "healing": {
      const mode = action.targeting?.target ?? "single";
      if (mode === "self") return { kind: "none" };
      if (mode === "area") return { kind: "area" };
      return { kind: "creatures", who: "allies", count: targetCapacity(action, casterLevel), repeat: false, range: action.range };
    }
    case "buff": {
      const mode = action.targeting?.target ?? "single";
      if (mode === "self") return { kind: "none" };
      return { kind: "creatures", who: "allies", count: targetCapacity(action, casterLevel), repeat: false, range: action.range };
    }
    case "reposition":
      return { kind: "place", moves: action.targeting?.target === "single" ? "other" : "self" };
    case "summon":
      // A pick of what comes (the demon chooses) is offered; a random one isn't a choice.
      return action.choice === "pick" && action.options.length > 1
        ? { kind: "option", options: action.options.map((option) => ({ id: option.id, label: option.label })) }
        : { kind: "none" };
    case "transform": {
      // The forms it isn't in now, and its own form when it can go back to it.
      const current = actor.activeForm?.definitionId;
      const forms = action.forms.filter((form) => form.definitionId !== current).map((form) => ({ id: form.id, label: form.label }));
      return { kind: "option", options: [...forms, ...(action.canRevert && current ? [{ id: BASE_FORM_ID, label: "Its own form" }] : [])] };
    }
    case "activate-feature":
    case "utility":
    case "unsupported":
      return { kind: "none" };
  }
}

/** How `actionId` of `actorId` is aimed (a legendary or lair action picked from a question): as the hotbar would aim it. */
export function aimForAction(board: EncounterSnapshot, actorId: Id, actionId: Id): Aim {
  const actor = board.combatants.find((combatant) => combatant.id === actorId);
  if (!actor) return { kind: "none" };
  const definition = getDefinition(board, actor);
  const executables = getExecutableActions(definition);
  const action = executables.find((candidate) => candidate.id === actionId);
  if (!action || automationOf(action) === "by-hand") return { kind: "none" };
  return aimOf(action, definition, executables, actor);
}

/** What using it costs, as a short chip: its slot, its pool, its recharge or uses, or how many attacks a routine makes. */
function costOf(action: ActionDefinition, definition?: CreatureDefinition): string | undefined {
  if (action.kind === "multiattack") {
    const swings = swingsOf(action.attacks).length;
    return `${swings} ${swings === 1 ? "attack" : "attacks"}`;
  }
  const usage = "usage" in action ? action.usage : undefined;
  if (usage) return usageLabel(usage);
  const cost = "resourceCost" in action ? action.resourceCost : undefined;
  // A potion's use spends one of it: its button says how many are left instead.
  if (action.item?.consumes) return undefined;
  return cost ? costText(cost, definition).replace(/^an? /, "") : undefined;
}

/** How many of an item are left: "×2" of a stack, "5 charges". */
function itemCount(actor: CombatantState, action: ActionDefinition): string | undefined {
  const cost = "resourceCost" in action ? action.resourceCost : undefined;
  if (!action.item || !cost) return undefined;
  const left = actor.resources?.[cost.resourceId] ?? 0;
  return action.item.consumes ? `×${left}` : `${left} ${left === 1 ? "charge" : "charges"}`;
}

const SLOT_WORDS = { action: "action", bonus: "bonus action", free: "free", reaction: "reaction" } as const;

/** A variant's name beside its family's others. `slotFamily`: a spell with copies at higher slots (Mage Armor too). */
function variantLabel(action: ActionDefinition, base: ActionDefinition, slotFamily = false): string {
  if (action.item?.use) {
    // An action spent where a bonus action would do: the full amount, a flat number on the copy ("Drink · full 10").
    const full = action.item.full && action.kind === "healing" ? ` · full ${action.healing.reduce((sum, component) => sum + (Number(component.dice) || 0), 0)}` : "";
    return `${action.item.use === "give" ? "Give" : "Drink"}${full}`;
  }
  // A wand's spell for the charges it spends, and the level that casts it at ("2 charges · 4th").
  const itemCost = action.item && "resourceCost" in action ? action.resourceCost : undefined;
  if (action.item && itemCost && "spellLevel" in action && action.spellLevel != null) {
    const spent = action.item.consumes ? `×${itemCost.amount}` : `${itemCost.amount} ${itemCost.amount === 1 ? "charge" : "charges"}`;
    return `${spent} · ${ordinal(action.spellLevel)}`;
  }
  if (action.kind === "multiattack") {
    const option = /\(([^)]*)\)$/.exec(action.name)?.[1];
    return action.id === base.id || !option ? action.name : option;
  }
  const slot = spellSlotLevel("resourceCost" in action ? action.resourceCost?.resourceId : undefined);
  // Metamagic or Overchannel: the slot, and the option ("3rd · Quickened", "3rd · Overchannel").
  const meta = action.metamagic ? ` · ${action.metamagic.name.replace(/ Spell$/, "")}` : action.maximizeDamage ? " · Overchannel" : "";
  if (slot !== undefined && (slotFamily || ("spellLevel" in action && action.spellLevel != null))) return `${slotLabel(action, slot)}${meta}`;
  if (meta) return meta.slice(3);
  const parts: string[] = [];
  if (/:power(?::|$)/.test(action.id)) parts.push("Power Attack");
  if (/:charged(?:-\d+)?$/.test(action.id)) parts.push("Spend a charge");
  return parts.length ? parts.join(" + ") : "Normal";
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "1d8" twice is "2d8"; anything else is repeated. */
function scaledDice(dice: string, times: number): string {
  const match = /^(\d+)d(\d+)$/.exec(dice);
  return match ? `${Number(match[1]) * times}d${match[2]}` : repeatDice(dice, times);
}

/**
 * A spell's slot, as its chip says it: the slot's level, and what that slot adds over the spell's own level ("5th ·
 * +2d6", "3rd · +1 target", "4th · +2 beams"). A slot that adds nothing is just its level.
 */
export function slotLabel(action: ActionDefinition, slot: number): string {
  const own = ("spellLevel" in action && action.spellLevel != null ? action.spellLevel : undefined) ?? action.upcastFrom ?? slot;
  const above = slot - own;
  const per = "upcast" in action ? action.upcast?.perSlotAboveBase : undefined;
  if (above <= 0 || !per || !upcastAddsSomething(action)) return ordinal(slot);
  const adds: string[] = [];
  if (per.damageDice) adds.push(`+${scaledDice(per.damageDice, above)}`);
  if (per.beams && action.kind === "attack" && action.attackDelivery === "beams") adds.push(`+${per.beams * above} ${per.beams * above === 1 ? "beam" : "beams"}`);
  if (per.targets) adds.push(`+${per.targets * above} ${per.targets * above === 1 ? "target" : "targets"}`);
  return adds.length ? `${ordinal(slot)} · ${adds.join(", ")}` : ordinal(slot);
}

const TRIGGER_WORDS: Partial<Record<string, string>> = {
  "would-be-hit": "when an attack would hit it",
  "targeted-by-attack": "when it's attacked",
  "hit-by-attack": "when an attack hits it",
  "ally-targeted-by-attack": "when a friend nearby is attacked",
  "enemy-casts-spell": "when an enemy casts a spell"
};

/** Its reactions: opportunity attacks as one (if it has a melee attack to make them with), then each other reaction. */
function reactionsOf(executables: ActionDefinition[]): HotbarReaction[] {
  const melee = executables.filter((action): action is Extract<ActionDefinition, { kind: "attack" }> => action.kind === "attack" && action.attackType === "melee"
    && !isLegendaryVariant(action) && !isLairVariant(action)
    && ((action.actionType === "action" && action.opportunityAttack !== false) || (action.actionType === "reaction" && action.reaction?.trigger.kind === "enemy-leaves-reach")));
  const weapons = [...new Set(melee.filter((action) => action.actionType === "action").map((action) => action.name))];
  const others = executables.filter((action) => action.actionType === "reaction" && !isLegendaryVariant(action) && !isLairVariant(action)
    && !isUpcastVariant(action) && !("reaction" in action && action.reaction?.trigger.kind === "enemy-leaves-reach"));
  return [
    ...(melee.length ? [{ key: OPPORTUNITY_ATTACKS, name: "Opportunity attacks", detail: weapons.length ? `with ${weapons.join(", ")}` : undefined }] : []),
    ...others.map((action) => {
      const trigger = "reaction" in action ? action.reaction?.trigger.kind : undefined;
      const cost = costOf(action);
      return { key: action.id, name: action.name, detail: [trigger ? TRIGGER_WORDS[trigger] : undefined, cost].filter(Boolean).join(" · ") || undefined };
    })
  ];
}

/** What the creature is concentrating on: the condition or zone it keeps going. */
export function concentrationOf(board: EncounterSnapshot, actor: CombatantState): string | undefined {
  const conditionId = actor.concentration?.sourceConditionId;
  if (conditionId) {
    for (const combatant of board.combatants) {
      const condition = (combatant.conditions ?? []).find((candidate) => candidate.id === conditionId);
      if (condition) return condition.sourceName ?? condition.name;
    }
  }
  return (board.activeZones ?? []).find((zone) => zone.concentration && zone.sourceCombatantId === actor.id)?.name;
}

/** Everything `actorId` can use on its turn, as the hotbar shows it. */
export function hotbarFor(board: EncounterSnapshot, actorId: Id): HotbarModel {
  const actor = board.combatants.find((combatant) => combatant.id === actorId);
  if (!actor) throw new Error(`${actorId} isn't in the fight`);
  const definition = getDefinition(board, actor);
  const executables = getExecutableActions(definition);
  const granted = featureGrantedIds(definition);

  // Families in the order the creature has them: the plain ability first, then its variants.
  const families = new Map<Id, ActionDefinition[]>();
  const grappled = (actor.conditions ?? []).some((condition) => condition.hold);
  for (const action of executables) {
    if (action.actionType === "reaction" || isLegendaryVariant(action) || isLairVariant(action)) continue;
    // Escaping a grapple is offered only while it's grappled.
    if (action.kind === "utility" && action.mode === "escape" && !grappled) continue;
    // An item's use is one button whatever its variants take: a potion drunk as a bonus action and given as an action.
    const key = `${familyKey(action.id)}|${action.item ? "item" : action.actionType}`;
    families.set(key, [...(families.get(key) ?? []), action]);
  }

  const buttons: HotbarButton[] = [...families.values()].map((members) => {
    const base = members.find((member) => member.id === familyKey(member.id)) ?? members[0]!;
    const ordered = [base, ...members.filter((member) => member !== base)];
    const automation = automationOf(base);
    const slotFamily = members.some((member) => member.upcastFrom != null);
    // An item's variants can take different slots; each then says which.
    const mixed = Boolean(base.item) && new Set(ordered.map((action) => action.actionType)).size > 1;
    const variants: HotbarVariant[] = ordered.map((action) => ({
      actionId: action.id,
      label: mixed ? `${variantLabel(action, base, slotFamily)} (${SLOT_WORDS[action.actionType]})` : variantLabel(action, base, slotFamily),
      cost: costOf(action, definition),
      ...(mixed && action.actionType !== "reaction" ? { slot: action.actionType } : {}),
      problem: actionProblem(board, actorId, action.id, { byHand: automation === "by-hand" }),
      aim: automation === "by-hand" ? { kind: "none" } : aimOf(action, definition, executables, actor),
      ...(spellSlotLevel("resourceCost" in action ? action.resourceCost?.resourceId : undefined) !== undefined
        ? { slotLevel: spellSlotLevel("resourceCost" in action ? action.resourceCost?.resourceId : undefined) }
        : {})
    }));
    const usable = variants.findIndex((variant) => !variant.problem);
    const entry = actionStatblock(base, definition);
    const item = base.item;
    const count = itemCount(actor, base);
    const slot = variants[Math.max(0, usable)]!.slot ?? (base.actionType === "reaction" ? "action" : base.actionType);
    return {
      key: familyKey(base.id),
      tab: tabOf(base, granted),
      // A wand's spell is "Web (Wand of Web)"; a potion's use is the potion.
      name: item && base.name !== item.name ? `${base.name} (${item.name})` : base.name,
      slot,
      variants,
      defaultVariant: Math.max(0, usable),
      // What a click spends: with a spell's own slots gone, the lowest higher one it'll use.
      cost: [count, variants[Math.max(0, usable)]!.cost].filter(Boolean).join(" · ") || undefined,
      ...(count ? { count } : {}),
      automation,
      problem: usable < 0 ? variants[0]!.problem : undefined,
      title: entry.title,
      text: entry.text,
      ...("spellLevel" in base && base.spellLevel != null ? { spellLevel: base.spellLevel } : {}),
      ...("concentration" in base && base.concentration ? { concentration: true } : {})
    };
  });

  // A zone the creature controls and can move (Moonbeam): a bonus action of its own.
  for (const zone of board.activeZones ?? []) {
    if (zone.sourceCombatantId !== actorId || !zone.repositionable) continue;
    const problem = zoneMoveProblem(board, actor, zone.id);
    buttons.push({
      key: `zone:${zone.id}`,
      tab: "bonus",
      name: `Move ${zone.name}`,
      slot: "bonus",
      variants: [{
        actionId: `zone:${zone.id}`,
        label: "Normal",
        problem,
        aim: { kind: "zone", zoneId: zone.id, maxFeet: zone.repositionable.maxFeetPerCasterTurn }
      }],
      defaultVariant: 0,
      cost: `up to ${zone.repositionable.maxFeetPerCasterTurn} ft`,
      automation: "full",
      problem,
      title: `Move ${zone.name}`,
      text: `Moves ${zone.name} up to ${zone.repositionable.maxFeetPerCasterTurn} ft.`
    });
  }

  // Spells by level, cantrips first; a multiattack heads the attacks, as in a statblock; the rest as the creature has them.
  const routine = (button: HotbarButton) => (button.variants[0]!.aim.kind === "routine" ? 0 : 1);
  const tabs = HOTBAR_TABS.map(({ id, label }) => ({
    id,
    label,
    buttons: buttons
      .filter((button) => button.tab === id)
      .map((button, index) => ({ button, index }))
      .sort((a, b) => (id === "spells" ? (a.button.spellLevel ?? 0) - (b.button.spellLevel ?? 0) : routine(a.button) - routine(b.button)) || a.index - b.index)
      .map(({ button }) => button)
  }))
    // Most creatures carry nothing: the Items tab shows only for one that does.
    .filter((tab) => tab.id !== "items" || tab.buttons.length > 0);

  const slots = Object.keys(definition.resources ?? {})
    .map((resourceId) => ({ resourceId, level: spellSlotLevel(resourceId) }))
    .filter((entry): entry is { resourceId: string; level: number } => entry.level !== undefined)
    .sort((a, b) => a.level - b.level)
    .map(({ resourceId, level }) => ({ level, left: actor.resources?.[resourceId] ?? 0, full: definition.resources?.[resourceId] ?? 0 }));

  return { actorId, tabs, slots, reactions: reactionsOf(executables), concentration: concentrationOf(board, actor) };
}
