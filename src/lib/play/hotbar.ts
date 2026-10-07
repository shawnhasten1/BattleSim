/**
 * The hotbar on a person's creature's turn in Play (PLAY_MODE_PLAN.md §2.2, §3.7; HOTBAR_REDESIGN_PLAN.md §1):
 * everything it can use, by what it costs (a tab per slot) and what it is (a group in the tab), one button per ability
 * with its variants folded in (the slot to cast at, Power Attack, spend a charge), what each costs, whether the engine
 * runs it, how it's aimed, and — greyed out — why it can't be used now, in the words the engine refuses with. A weapon
 * is pressed as a swing of the creature's Attack action or Multiattack, whose swings ride its weapons (§3: there's no
 * button for the routine itself). Pure: the Hotbar shows it, tests read it.
 */
import {
  actionProblem,
  BASE_FORM_ID,
  OPPORTUNITY_ATTACKS,
  casterLevelOf,
  defaultSwingAttack,
  freeRoutines,
  getDefinition,
  getExecutableActions,
  isLairVariant,
  isLegendaryVariant,
  isUpcastVariant,
  multiattackBaseId,
  planSwing,
  repeatDice,
  routineBaseId,
  routinesOf,
  spellSlotLevel,
  stepAbility,
  swingCandidates,
  swingProblem,
  swingsFilledBy,
  swingsLeftOf,
  upcastAddsSomething,
  swingsOf,
  targetCapacity,
  zoneMoveProblem,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type DamageTypeReference,
  type EncounterSnapshot,
  type Id,
  type MultiattackActionDefinition,
  type OpenRoutine
} from "@/engine";
import { actionStatblock, costText, usageLabel } from "@/lib/statblock";

/** What using it costs: the action (or nothing: free), the bonus action, or the reaction. */
export type HotbarTab = "actions" | "bonus" | "reactions";

export const HOTBAR_TABS: ReadonlyArray<{ id: HotbarTab; label: string }> = [
  { id: "actions", label: "Actions" },
  { id: "bonus", label: "Bonus" },
  { id: "reactions", label: "Reactions" }
];

/** What it is, as a tab's buttons are grouped. */
export type HotbarGroup = "attacks" | "spells" | "features" | "items" | "common";

export const HOTBAR_GROUPS: ReadonlyArray<{ id: HotbarGroup; label: string }> = [
  { id: "attacks", label: "Attacks" },
  { id: "spells", label: "Spells" },
  { id: "features", label: "Features" },
  { id: "items", label: "Items" },
  { id: "common", label: "Common" }
];

/** A spell's colour from the damage it deals: bludgeoning, piercing and slashing share one. */
const DAMAGE_TONES = ["acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder", "physical"] as const;
/** A spell's colour from its school, when it deals no damage. */
const SCHOOL_TONES = ["abjuration", "conjuration", "divination", "enchantment", "evocation", "illusion", "necromancy", "transmutation"] as const;

/**
 * A button's colour (HOTBAR_REDESIGN_PLAN.md §2): its group's, or for a spell its element — the damage it deals, healing,
 * its school, or plain `"spell"`.
 */
export type HotbarTone = Exclude<HotbarGroup, "spells"> | "spell" | "healing" | (typeof DAMAGE_TONES)[number] | (typeof SCHOOL_TONES)[number];

export const HOTBAR_TONES: readonly HotbarTone[] = ["attacks", "features", "items", "common", "spell", "healing", ...DAMAGE_TONES, ...SCHOOL_TONES];

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
  /**
   * Pressed, it's a swing of a routine (the `swing` command): the next of the one open in its slot, or the first of one
   * it opens. `routineId`: the costed routine it opens by name (Flurry of Blows).
   */
  swing?: { routineId?: Id };
}

/**
 * A swing's routine, for its badge: its name, the swings left of it (or, not open yet, how many it makes), out of how
 * many, and whether it's open.
 */
export interface HotbarRoutine {
  name: string;
  left: number;
  total: number;
  open: boolean;
}

export type Automation = "full" | "partial" | "by-hand";

export interface HotbarButton {
  /** The family's id: the plain ability its variants are copies of. */
  key: string;
  /** Its slot's tab: an action or a free one under Actions, a bonus action under Bonus. */
  tab: HotbarTab;
  group: HotbarGroup;
  tone: HotbarTone;
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
  /** Pressed as a swing: the routine it's a swing of ("×2" before the first swing, "⚔ 1 left" after). */
  routine?: HotbarRoutine;
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
  /**
   * Each tab's buttons by group, the groups in `HOTBAR_GROUPS`' order (only those with buttons), and the same buttons
   * in one list in that order, which the number keys count along. The Reactions tab has none: it's `reactions`.
   */
  tabs: Array<{ id: HotbarTab; label: string; buttons: HotbarButton[]; groups: Array<{ id: HotbarGroup; label: string; buttons: HotbarButton[] }> }>;
  /** Spell slots by level: what's left and the full count. */
  slots: Array<{ level: number; left: number; full: number }>;
  /** What the creature is concentrating on, if anything. */
  concentration?: string;
  /** Its routines open, by slot ("Attack · 1 left" on the slot's pill), with what they say that isn't simulated. */
  routines: Array<HotbarRoutine & { slot: OpenRoutine["slot"]; unsimulated?: string[] }>;
}

/**
 * Copies of an ability that change one thing about it: a power attack, spending a charge, a higher slot, giving a
 * potion, a wand's spell for more charges.
 */
const VARIANT_SUFFIX = /:(?:power|charged(?:-\d+)?|upcast-\d+|give|full|charges-\d+|meta-[a-z+]+(?:-free)?|overchannel|no-concentration|imbued|with-[a-z0-9-]+|mastery-[a-z]+)$/;

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

/** A spell of the creature's, as its spell list has it: what an action the engine doesn't run (by hand) is cast from. */
type SpellOf = NonNullable<CreatureDefinition["spells"]>[number];

/** What it is: an item's use, one of the actions anyone can take, a spell, an attack, or a feature's. */
function groupOf(action: ActionDefinition, granted: Set<Id>, spell?: SpellOf): HotbarGroup {
  if (action.item) return "items";
  if (action.kind === "utility") return "common";
  if (("spellLevel" in action && action.spellLevel != null) || spell) return "spells";
  if (action.kind === "attack" || action.kind === "multiattack") return "attacks";
  if (action.kind === "activate-feature" || granted.has(familyKey(action.id))) return "features";
  if (action.kind === "save" || action.kind === "area-save") return "attacks";
  return "features";
}

function damageTone(type: DamageTypeReference | undefined): HotbarTone | undefined {
  if (!type || type === "same-as-attack") return undefined;
  return type === "bludgeoning" || type === "piercing" || type === "slashing" ? "physical" : type;
}

/**
 * Its colour: its group's, or a spell's element — healing, then the damage it deals (a zone's for one that only leaves a
 * zone, Spike Growth), then its school. A weapon is an attack whatever it deals; a wand's spell is an item.
 */
function toneOf(action: ActionDefinition, group: HotbarGroup, spell?: SpellOf): HotbarTone {
  if (group !== "spells") return group;
  if (action.kind === "healing") return "healing";
  const damage = "damage" in action && Array.isArray(action.damage) ? action.damage : [];
  const tones = damage.map((component) => damageTone(component.damageType)).filter((tone): tone is HotbarTone => Boolean(tone));
  // An element over plain force of arms: Ice Storm's hail is bludgeoning, but it's a cold spell.
  const dealt = tones.find((tone) => tone !== "physical") ?? tones[0]
    ?? (action.kind === "area-save" ? damageTone(action.zone?.movementDamage?.damageType) : undefined);
  if (dealt) return dealt;
  const school = (action.spellSchool ?? spell?.school)?.toLowerCase();
  return SCHOOL_TONES.find((tone) => tone === school) ?? "spell";
}

/** The tab a slot's abilities are on: a free one goes with the actions (Action Surge, Reckless Attack). */
function tabOfSlot(slot: HotbarButton["slot"]): HotbarTab {
  return slot === "bonus" ? "bonus" : "actions";
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
function costOf(action: ActionDefinition, definition?: CreatureDefinition, spentOnly = false): string | undefined {
  // A routine pressed by name says what it spends; its badge says how many attacks it makes.
  if (action.kind === "multiattack" && !spentOnly) {
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
  // An Attack with Breath Weapon in place of an attack: the breath.
  if (action.withReplacement) return `With ${action.withReplacement.name}`;
  if (action.kind === "multiattack") {
    const option = /\(([^)]*)\)$/.exec(action.name)?.[1];
    return action.id === base.id || !option ? action.name : option;
  }
  // True Strike: the weapon it's made with.
  if (action.viaWeapon) return action.viaWeapon.name;
  const slot = spellSlotLevel("resourceCost" in action ? action.resourceCost?.resourceId : undefined);
  // Metamagic or Overchannel: the slot, and the option ("3rd · Quickened", "3rd · Overchannel").
  const meta = action.metamagic ? ` · ${action.metamagic.name.replace(/ Spell$/, "")}` : action.maximizeDamage ? " · Overchannel" : "";
  if (slot !== undefined && (slotFamily || ("spellLevel" in action && action.spellLevel != null))) return `${slotLabel(action, slot)}${meta}`;
  if (meta) return meta.slice(3);
  const parts: string[] = [];
  if (/:power(?::|$)/.test(action.id)) parts.push("Power Attack");
  // An on-hit option (Open Hand: Addle, Divine Smite) by its name; a weapon's charge spent.
  const option = action.name.startsWith(`${base.name} (`) && action.name.endsWith(")") ? action.name.slice(base.name.length + 2, -1) : undefined;
  if (/:charged(?:-\d+)?$/.test(action.id)) parts.push(option ?? "Spend a charge");
  // Shillelagh: the weapon while the spell is on. Tactical Master: the mastery used instead.
  if (action.whileCondition) parts.push(action.whileCondition.name);
  if (action.swappedMastery) parts.push(`${action.swappedMastery.to.charAt(0).toUpperCase()}${action.swappedMastery.to.slice(1)}`);
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
  // The engine stamps a spell's level and school only on the kinds it runs; a spell used by hand (Hex, Mage Hand) has
  // them in the creature's spell list.
  const spellOf = new Map<Id, SpellOf>((definition.spells ?? []).flatMap((spell) => (spell.action ? [[spell.action.id, spell] as const] : [])));

  // Families in the order the creature has them: the plain ability first, then its variants.
  const families = new Map<Id, ActionDefinition[]>();
  const grappled = (actor.conditions ?? []).some((condition) => condition.hold);
  // The Attack action, a Multiattack: no button of their own. Their swings ride the weapons (D1).
  const free = new Set(freeRoutines(executables).map((routine) => routine.id));
  for (const action of executables) {
    if (action.actionType === "reaction" || isLegendaryVariant(action) || isLairVariant(action) || free.has(action.id)) continue;
    // Escaping a grapple is offered only while it's grappled.
    if (action.kind === "utility" && action.mode === "escape" && !grappled) continue;
    // One button per slot: a potion drunk as a bonus action is on Bonus, giving it (an action) on Actions.
    const key = `${familyKey(action.id)}|${action.actionType}`;
    families.set(key, [...(families.get(key) ?? []), action]);
  }
  // Items whose uses take more than one slot: each of their buttons names its uses.
  const itemSlots = new Map<Id, Set<string>>();
  for (const members of families.values()) {
    const item = members[0]!.item;
    if (item) itemSlots.set(item.id, new Set([...(itemSlots.get(item.id) ?? []), members[0]!.actionType]));
  }

  const swings = swingsOfRoutines(board, actor, executables);

  const buttons: HotbarButton[] = [...families.values()].map((members) => {
    // The plain ability; for an item's use given as an action, its first copy (the Give of a potion drunk as a bonus action).
    const base = members.find((member) => member.id === familyKey(member.id)) ?? members[0]!;
    const ordered = [base, ...members.filter((member) => member !== base)];
    const automation = automationOf(base);
    const slotFamily = members.some((member) => member.upcastFrom != null);
    const swing = automation === "by-hand" ? undefined : swings.of(base);
    const variants: HotbarVariant[] = base.kind === "multiattack" && swing
      ? swings.byName(members as MultiattackActionDefinition[], (action, of) => variantLabel(action, of), (action) => aimOf(action, definition, executables, actor))
      : ordered.map((action) => ({
        actionId: action.id,
        label: variantLabel(action, base, slotFamily),
        cost: costOf(action, definition),
        problem: swing ? swingProblem(board, actorId, action.id) : actionProblem(board, actorId, action.id, { byHand: automation === "by-hand" }),
        aim: automation === "by-hand" ? { kind: "none" } : aimOf(action, definition, executables, actor),
        ...(swing ? { swing: {} } : {}),
        ...(spellSlotLevel("resourceCost" in action ? action.resourceCost?.resourceId : undefined) !== undefined
          ? { slotLevel: spellSlotLevel("resourceCost" in action ? action.resourceCost?.resourceId : undefined) }
          : {})
      }));
    // A weapon its routine has no swing left for, with the routine's action gone: the action went to the routine (D8).
    const heldBy = swings.holding(base);
    if (!swing && heldBy) {
      for (const variant of variants) {
        if (variant.problem === `${actor.displayName} has already used its ${heldBy.slot === "bonus" ? "bonus action" : "action"}`) variant.problem = `${actor.displayName}'s ${heldBy.slot === "bonus" ? "bonus action" : "action"} went to ${heldBy.name}`;
      }
    }
    const usable = variants.findIndex((variant) => !variant.problem);
    const entry = actionStatblock(base, definition);
    const item = base.item;
    const count = itemCount(actor, base);
    const slot = base.actionType === "reaction" ? "action" : base.actionType;
    // A potion given with an action and drunk with a bonus action: the button with only one of them says which.
    const oneUse = item && (itemSlots.get(item.id)?.size ?? 0) > 1 && variants.length === 1 ? variants[0]!.label : undefined;
    const spell = spellOf.get(familyKey(base.id));
    // A feature's ability pressed as a swing of the Attack action (a dragonborn's Breath Weapon) goes with the attacks.
    const grouped = groupOf(base, granted, spell);
    const group = swing && grouped === "features" ? "attacks" : grouped;
    const spellLevel = "spellLevel" in base && base.spellLevel != null ? base.spellLevel : spell?.level;
    return {
      key: familyKey(base.id),
      tab: tabOfSlot(slot),
      group,
      tone: toneOf(base, group, spell),
      // A wand's spell is "Web (Wand of Web)"; a potion's use is the potion; True Strike's copies are True Strike.
      name: oneUse ? `${item!.name}: ${oneUse}`
        : item && base.name !== item.name ? `${base.name} (${item.name})` : base.viaWeapon ? base.name.replace(/ \([^)]*\)$/, "") : base.name,
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
      ...(spellLevel != null ? { spellLevel } : {}),
      ...("concentration" in base && base.concentration ? { concentration: true } : {}),
      ...(swing?.routine ? { routine: swing.routine } : {})
    };
  });

  // A zone the creature controls and can move (Moonbeam): a bonus action of its own.
  for (const zone of board.activeZones ?? []) {
    if (zone.sourceCombatantId !== actorId || !zone.repositionable) continue;
    const problem = zoneMoveProblem(board, actor, zone.id);
    buttons.push({
      key: `zone:${zone.id}`,
      tab: "bonus",
      group: "spells",
      // The colour of the spell that left it: Moonbeam's radiant.
      tone: (zone.damage ?? []).map((component) => damageTone(component.damageType)).find(Boolean) ?? "spell",
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

  // Spells by level, cantrips first; the rest as the creature has them.
  const tabs = HOTBAR_TABS.map(({ id, label }) => {
    const groups = HOTBAR_GROUPS.map((group) => ({
      ...group,
      buttons: buttons
        .filter((button) => button.tab === id && button.group === group.id)
        .map((button, index) => ({ button, index }))
        .sort((a, b) => (group.id === "spells" ? (a.button.spellLevel ?? 0) - (b.button.spellLevel ?? 0) : 0) || a.index - b.index)
        .map(({ button }) => button)
    })).filter((group) => group.buttons.length > 0);
    return { id, label, groups, buttons: groups.flatMap((group) => group.buttons) };
  });

  const slots = Object.keys(definition.resources ?? {})
    .map((resourceId) => ({ resourceId, level: spellSlotLevel(resourceId) }))
    .filter((entry): entry is { resourceId: string; level: number } => entry.level !== undefined)
    .sort((a, b) => a.level - b.level)
    .map(({ resourceId, level }) => ({ level, left: actor.resources?.[resourceId] ?? 0, full: definition.resources?.[resourceId] ?? 0 }));

  return { actorId, tabs, slots, reactions: reactionsOf(executables), concentration: concentrationOf(board, actor), routines: swings.open };
}

/** A routine as the creature has it: "Attack", not its copy "Attack with Breath Weapon (cone)"; "Multiattack", not an option. */
function routineName(routines: MultiattackActionDefinition[], executables: ActionDefinition[]): string {
  const first = routines[0];
  if (!first) return "Attack";
  return executables.find((action) => action.id === routineBaseId(first.id))?.name ?? first.name;
}

/**
 * How the hotbar presses the creature's routines' swings (HOTBAR_REDESIGN_PLAN.md §3): which of its abilities are swings
 * (a weapon its Attack action or Multiattack swings, Frightful Presence, Breath Weapon in place of an attack), each
 * one's routine for its badge, the variants of a routine pressed by name (Flurry of Blows), and the routines open.
 */
function swingsOfRoutines(board: EncounterSnapshot, actor: CombatantState, executables: ActionDefinition[]) {
  const actorId = actor.id;
  const all = executables.filter((action): action is MultiattackActionDefinition => action.kind === "multiattack" && !isLegendaryVariant(action) && !isLairVariant(action));
  // Everything a swing of one of its routines can be made with.
  const swingable = new Set(all.flatMap((routine) => swingsOf(routine.attacks).flatMap((swing) => {
    const ability = stepAbility(swing.step, executables);
    return ability ? [ability.id] : swingCandidates(swing.step, executables).map((candidate) => candidate.id);
  })));
  const opens = actor.turnFlags?.routines ?? [];
  const badge = (routines: MultiattackActionDefinition[], made: OpenRoutine["made"], open: boolean): HotbarRoutine => {
    const left = swingsLeftOf(routines, made, executables);
    return { name: routineName(routines, executables), left, total: left + made.length, open };
  };
  /** The routine open that `action` is one of the swings of, whether or not it has one left for it. */
  const openFor = (action: ActionDefinition) => opens.find((open) => routinesOf(executables, open).some((routine) => swingsFilledBy(routine, action.id, executables).length > 0));

  return {
    /** Pressed as a swing: of a routine it opens or goes on with, and its badge. Undefined: a plain use. */
    of(base: ActionDefinition): { routine?: HotbarRoutine } | undefined {
      if (base.kind === "multiattack") {
        // A routine pressed by name (D4: Flurry of Blows): its first swing opens it.
        const swingCount = swingsOf(base.attacks).filter((swing) => !stepAbility(swing.step, executables)).length;
        return { routine: { name: base.name, left: swingCount, total: swingCount, open: false } };
      }
      if (!swingable.has(base.id) || (base.kind !== "attack" && base.kind !== "save" && base.kind !== "area-save")) return undefined;
      const plan = planSwing(board, actorId, base.id);
      if (!("problem" in plan)) {
        return { routine: plan.open ? badge(routinesOf(executables, plan.open), plan.open.made, true) : badge(plan.routines, [], false) };
      }
      // One of the open routine's own swings that it has none left for, or not now (after a miss): greyed, saying why.
      const open = openFor(base);
      if (open) return { routine: badge(routinesOf(executables, open), open.made, true) };
      // Breath Weapon in place of an attack is only ever a swing.
      return base.routineOnly ? {} : undefined;
    },
    /** A weapon not pressed as a swing whose slot a routine open holds: the routine (D8). */
    holding(base: ActionDefinition): { slot: OpenRoutine["slot"]; name: string } | undefined {
      const open = opens.find((entry) => entry.slot === base.actionType);
      return open ? { slot: open.slot, name: routineName(routinesOf(executables, open), executables) } : undefined;
    },
    /**
     * A routine pressed by name's variants: with one routine, an attack its first swing can be made with each (Flurry's
     * strike plainly, or with Open Hand's Addle); with options, one each, its first swing with its plainest attack.
     */
    byName(members: MultiattackActionDefinition[], label: (action: ActionDefinition, of: ActionDefinition) => string, aim: (action: ActionDefinition) => Aim): HotbarVariant[] {
      const first = (routine: MultiattackActionDefinition) => swingsOf(routine.attacks).find((swing) => !stepAbility(swing.step, executables));
      const cost = (routine: MultiattackActionDefinition) => costOf(routine, getDefinition(board, actor), true);
      const variant = (routine: MultiattackActionDefinition, attack: ActionDefinition, name: string): HotbarVariant => ({
        actionId: attack.id, label: name, cost: cost(routine), problem: swingProblem(board, actorId, attack.id, {}, routine.id), aim: aim(attack), swing: { routineId: routine.id }
      });
      if (members.length === 1) {
        const routine = members[0]!;
        const swing = first(routine);
        const strikes = swing ? swingCandidates(swing.step, executables) : [];
        return strikes.map((attack) => variant(routine, attack, label(attack, strikes[0]!)));
      }
      return members.flatMap((routine) => {
        const swing = first(routine);
        const attack = swing ? defaultSwingAttack(swing.step, swingCandidates(swing.step, executables)) : undefined;
        return attack ? [variant(routine, attack, label(routine, members[0]!))] : [];
      });
    },
    /** The routines open, by slot. */
    open: opens.map((open) => {
      const routines = routinesOf(executables, open);
      const unsimulated = [...new Set(routines.flatMap((routine) => routine.unsimulated ?? []))];
      return { slot: open.slot, ...badge(routines, open.made, true), ...(unsimulated.length ? { unsimulated } : {}) };
    })
  };
}
