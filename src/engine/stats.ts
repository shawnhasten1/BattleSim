import { isArmorItem, isWorn, slowedByArmor, type ArmorItem } from "./armor";
// A cycle, used only inside functions: combat.ts reads this module's effectiveDefinition the same way.
import { resolveNumericFormula } from "./combat";
import { workingItems } from "./items";
import type { Ability, CombatantState, CreatureDefinition, FeatureEffect, MovementProfile, SelfGate, SizeCategory } from "./types";

/**
 * A creature's stats as its effects make them (EFFECTS_PLAN.md): its speed and movement modes (Phase 1), hit point
 * maximum (Phase 2) and ability scores (Phase 3). They come from its features and traits the simulator runs, its weapons'
 * and working items' effects, and its conditions: their effects, and the older `flySpeed` / `speedBonusFt` / `sizeTo`
 * modifiers (Draconic Flight, Large Form). `getDefinition` returns the result, so everything that reads a combatant's
 * definition through it sees the change; the sheet reads it through `effectiveDefinition` and `statParts`.
 */

type SpeedEffect = Extract<FeatureEffect, { kind: "speed" }>;
type HitPointEffect = Extract<FeatureEffect, { kind: "hit-point-maximum" }>;
type ScoreEffect = Extract<FeatureEffect, { kind: "ability-score" }>;

/** The kinds that change the stat block itself. */
const STAT_KINDS = new Set<FeatureEffect["kind"]>(["speed", "hit-point-maximum", "ability-score"]);

/** A stat-changing effect and what it comes from (a feature's, item's or condition's name). */
interface StatSource {
  label: string;
  effect: FeatureEffect;
}

/** Where part of a stat comes from, as the sheet says it: "Boots of Striding +10". */
export interface StatPart {
  label: string;
  value: number;
}

const simulated = (support: string) => support !== "manual-only" && support !== "unsupported";

const ownSources = new WeakMap<CreatureDefinition, StatSource[]>();

/**
 * The creature's own stat-changing effects: from features and traits the simulator runs (as `simulatedFeatures`
 * picks them), weapons, and items that work (attuned, worn). Pure in the definition, so kept per definition.
 */
function ownStatSources(definition: CreatureDefinition): StatSource[] {
  const known = ownSources.get(definition);
  if (known) return known;
  const sources: StatSource[] = [];
  const take = (label: string, effects: FeatureEffect[] | undefined) => {
    for (const effect of effects ?? []) if (STAT_KINDS.has(effect.kind)) sources.push({ label, effect });
  };
  for (const feature of [...(definition.features ?? []), ...(definition.traits ?? [])]) {
    if (!feature.informational && simulated(feature.automationSupport)) take(feature.name, feature.effects);
  }
  for (const weapon of definition.weapons ?? []) take(weapon.name, weapon.effects);
  for (const item of workingItems(definition)) if (simulated(item.automationSupport)) take(item.name, item.effects);
  ownSources.set(definition, sources);
  return sources;
}

/** What its conditions change: their stat effects, and the older modifiers as the effects they stand for. */
function conditionStatSources(combatant: CombatantState | undefined): { sources: StatSource[]; size?: SizeCategory } {
  const sources: StatSource[] = [];
  let size: SizeCategory | undefined;
  for (const condition of combatant?.conditions ?? []) {
    const label = condition.sourceName ?? condition.id;
    for (const effect of condition.effects ?? []) if (STAT_KINDS.has(effect.kind)) sources.push({ label, effect });
    const modifiers = condition.modifiers;
    if (!modifiers) continue;
    if (modifiers.speedBonusFt) sources.push({ label, effect: { kind: "speed", bonusFt: modifiers.speedBonusFt } });
    if (modifiers.flySpeed !== undefined) sources.push({ label, effect: { kind: "speed", modes: { fly: modifiers.flySpeed } } });
    // The latest size change wins.
    if (modifiers.sizeTo) size = modifiers.sizeTo;
  }
  return { sources, size };
}

/* ─── "While" ────────────────────────────────────────────────────────────── */

/** The worn suits of armor and shields the simulator counts (not ones kept for reference only). */
export function wornArmor(definition: Pick<CreatureDefinition, "items">): { suit?: ArmorItem; shield?: ArmorItem } {
  const worn = (definition.items ?? []).filter((item): item is ArmorItem => isArmorItem(item) && isWorn(item) && simulated(item.automationSupport));
  const suits = worn.filter((item) => item.armor.category !== "shield");
  // The heaviest suit decides "not in heavy armor".
  const order = { heavy: 0, medium: 1, light: 2, shield: 3 } as const;
  const suit = [...suits].sort((a, b) => order[a.armor.category] - order[b.armor.category])[0];
  const shield = worn.find((item) => item.armor.category === "shield");
  return { ...(suit ? { suit } : {}), ...(shield ? { shield } : {}) };
}

/**
 * Whether an effect's "While" holds for the creature (`SelfGate`): armor worn, none, or none heavy; a shield or not; an
 * activation's condition. Without a combatant (the sheet), a condition it needs isn't held.
 */
export function selfGateHolds(definition: Pick<CreatureDefinition, "items">, combatant: Pick<CombatantState, "conditions"> | undefined, gate: SelfGate): boolean {
  if (gate.armor || gate.shield !== undefined) {
    const { suit, shield } = wornArmor(definition);
    if (gate.armor === "worn" && !suit) return false;
    if (gate.armor === "none" && suit) return false;
    if (gate.armor === "not-heavy" && suit?.armor.category === "heavy") return false;
    if (gate.shield !== undefined && Boolean(shield) !== gate.shield) return false;
  }
  if (gate.whileCondition && !(combatant?.conditions ?? []).some((condition) => condition.id === gate.whileCondition)) return false;
  return true;
}

/* ─── speed ──────────────────────────────────────────────────────────────── */

const OTHER_MODES = ["fly", "swim", "climb", "burrow"] as const;

/**
 * Its movement with these speed effects, and how the walking speed came about. In order (EFFECTS_PLAN.md D8): the base
 * walking speed; heavy armor too heavy for it, 10 ft less (unless an effect says it doesn't slow it); every bonus added;
 * the largest multiplier (multipliers don't stack); the largest minimum. A bonus or multiplier with `allModes` changes
 * the speeds it already has too. A mode it gains is its walking speed (`"walk"`) or a number, keeping a faster one it
 * already has.
 */
export function speedWith(definition: CreatureDefinition, sources: Array<{ label: string; effect: SpeedEffect }>): { movement: MovementProfile; parts: StatPart[] } {
  const parts: StatPart[] = [{ label: "base", value: definition.speed }];
  const others: Partial<Record<(typeof OTHER_MODES)[number], number>> = {};
  for (const mode of OTHER_MODES) if (definition.movement?.[mode]) others[mode] = definition.movement[mode];
  let walk = definition.speed;
  if (slowedByArmor(definition) && !sources.some(({ effect }) => effect.noArmorSlowdown)) {
    walk -= 10;
    parts.push({ label: "heavy armor", value: -10 });
  }
  for (const { label, effect } of sources) {
    if (!effect.bonusFt) continue;
    walk += effect.bonusFt;
    parts.push({ label, value: effect.bonusFt });
    if (effect.allModes) for (const mode of OTHER_MODES) if (others[mode]) others[mode] = Math.max(0, others[mode]! + effect.bonusFt);
  }
  const doubling = sources.filter(({ effect }) => (effect.multiplier ?? 1) > 1).sort((a, b) => b.effect.multiplier! - a.effect.multiplier!)[0];
  if (doubling && walk > 0) {
    const multiplied = Math.floor(walk * doubling.effect.multiplier!);
    parts.push({ label: `${doubling.label} ×${doubling.effect.multiplier}`, value: multiplied - walk });
    walk = multiplied;
    if (doubling.effect.allModes) for (const mode of OTHER_MODES) if (others[mode]) others[mode] = Math.floor(others[mode]! * doubling.effect.multiplier!);
  }
  const floor = sources.filter(({ effect }) => effect.minimumFt !== undefined).sort((a, b) => b.effect.minimumFt! - a.effect.minimumFt!)[0];
  if (floor && walk < floor.effect.minimumFt!) {
    parts.push({ label: `${floor.label} (at least ${floor.effect.minimumFt} ft)`, value: floor.effect.minimumFt! - walk });
    walk = floor.effect.minimumFt!;
  }
  walk = Math.max(0, walk);
  let hover = definition.movement?.hover;
  for (const { effect } of sources) {
    for (const mode of OTHER_MODES) {
      const granted = effect.modes?.[mode];
      if (granted === undefined) continue;
      const feet = granted === "walk" ? walk : granted;
      if (feet > (others[mode] ?? 0)) others[mode] = feet;
    }
    if (effect.hover) hover = true;
  }
  return { movement: { ...others, walk, ...(hover ? { hover } : {}) }, parts };
}

/* ─── ability scores ─────────────────────────────────────────────────────── */

const ABILITY_LIST: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/** The ability each skill uses, by its id with anything but letters taken out ("sleightofhand"). */
const SKILL_ABILITY: Record<string, Ability> = {
  acrobatics: "dex", animalhandling: "wis", arcana: "int", athletics: "str", deception: "cha", history: "int", insight: "wis",
  intimidation: "cha", investigation: "int", medicine: "wis", nature: "int", perception: "wis", performance: "cha",
  persuasion: "cha", religion: "int", sleightofhand: "dex", stealth: "dex", survival: "wis"
};

/**
 * Its scores with these effects, and how each changed one came about. For each ability: the highest "at least" (Gauntlets
 * of Ogre Power: Strength 19) when it's above the score, then each bonus up to its maximum (an Ioun Stone of Fortitude:
 * +2, to 20). A bonus never takes a score past its maximum, nor down to it.
 */
export function scoresWith(abilities: Record<Ability, number>, sources: Array<{ label: string; effect: ScoreEffect }>): {
  abilities: Record<Ability, number>;
  parts: Partial<Record<Ability, StatPart[]>>;
} {
  const next = { ...abilities };
  const parts: Partial<Record<Ability, StatPart[]>> = {};
  for (const ability of ABILITY_LIST) {
    const mine = sources.filter(({ effect }) => effect.ability === ability);
    if (!mine.length) continue;
    const list: StatPart[] = [{ label: "base", value: abilities[ability] }];
    const floor = mine.filter(({ effect }) => effect.setTo !== undefined).sort((a, b) => b.effect.setTo! - a.effect.setTo!)[0];
    if (floor && floor.effect.setTo! > next[ability]) {
      list.push({ label: floor.label, value: floor.effect.setTo! - next[ability] });
      next[ability] = floor.effect.setTo!;
    }
    for (const { label, effect } of mine) {
      if (!effect.bonus) continue;
      const raised = effect.bonus > 0 ? Math.max(next[ability], Math.min(effect.max ?? 30, next[ability] + effect.bonus)) : next[ability] + effect.bonus;
      if (raised === next[ability]) continue;
      list.push({ label, value: raised - next[ability] });
      next[ability] = Math.max(1, raised);
    }
    if (list.length > 1) parts[ability] = list;
  }
  return { abilities: next, parts };
}

const modifier = (score: number) => Math.floor((score - 10) / 2);

/** Its character level, or 0 for a creature without one (a monster: its hit points don't follow its Constitution). */
function characterLevel(definition: CreatureDefinition): number {
  return definition.character?.level ?? definition.character?.classes?.reduce((sum, entry) => sum + entry.level, 0) ?? 0;
}

/**
 * The definition with new scores, and what follows them that's written down as a total: its listed saves and skills
 * move by the modifier's change, and a creature with a character level gains (or loses) that change in Constitution for
 * each level in hit points, as the rules say (D4). A fixed attack bonus or damage written as a number doesn't move.
 */
function withScores(definition: CreatureDefinition, abilities: Record<Ability, number>): CreatureDefinition {
  const change = (ability: Ability) => modifier(abilities[ability]) - modifier(definition.abilities[ability]);
  const next: CreatureDefinition = { ...definition, abilities };
  if (definition.saves) {
    const saves: Partial<Record<Ability, number>> = {};
    for (const [ability, total] of Object.entries(definition.saves) as Array<[Ability, number | undefined]>) {
      if (typeof total === "number") saves[ability] = total + change(ability);
    }
    next.saves = saves;
  }
  if (definition.skills) {
    const skills: Record<string, number> = {};
    for (const [skill, total] of Object.entries(definition.skills)) {
      const ability = SKILL_ABILITY[skill.toLowerCase().replace(/[^a-z]/g, "")];
      skills[skill] = ability ? total + change(ability) : total;
    }
    next.skills = skills;
  }
  const level = characterLevel(definition);
  if (level && change("con")) next.maxHp = Math.max(1, definition.maxHp + change("con") * level);
  return next;
}

/* ─── the creature as its effects make it ────────────────────────────────── */

/** What it gets: the sources that apply now, gated, and a size change. */
function applying(definition: CreatureDefinition, combatant: CombatantState | undefined) {
  const own = ownStatSources(definition);
  const fromConditions = conditionStatSources(combatant);
  const holds = (source: StatSource) => selfGateHolds(definition, combatant, source.effect as SelfGate);
  const sources = [...own, ...fromConditions.sources].filter(holds);
  const of = <K extends FeatureEffect["kind"]>(kind: K) =>
    sources.filter((source): source is { label: string; effect: Extract<FeatureEffect, { kind: K }> } => source.effect.kind === kind);
  return { speed: of("speed"), hitPoints: of("hit-point-maximum"), scores: of("ability-score"), size: fromConditions.size };
}

/* ─── hit points ─────────────────────────────────────────────────────────── */

/**
 * Its hit point maximum with these effects, and where it came from: the typed maximum, then each bonus (Tough: 2 per
 * level; Aid: 5), worked out on the creature. Never below 1.
 */
export function hitPointsWith(definition: CreatureDefinition, sources: Array<{ label: string; effect: HitPointEffect }>): { maxHp: number; parts: StatPart[] } {
  const parts: StatPart[] = [{ label: "base", value: definition.maxHp }];
  let maxHp = definition.maxHp;
  for (const { label, effect } of sources) {
    const value = resolveNumericFormula(effect.bonus, definition);
    if (!value) continue;
    maxHp += value;
    parts.push({ label, value });
  }
  return { maxHp: Math.max(1, maxHp), parts };
}

/** The definition its scores make (scores first: Strength decides heavy armor's slowdown, Constitution hit points). */
function scored(definition: CreatureDefinition, scores: Array<{ label: string; effect: ScoreEffect }>): CreatureDefinition {
  if (!scores.length) return definition;
  const { abilities } = scoresWith(definition.abilities, scores);
  return ABILITY_LIST.some((ability) => abilities[ability] !== definition.abilities[ability]) ? withScores(definition, abilities) : definition;
}

const derived = new WeakMap<CreatureDefinition, Map<string, CreatureDefinition>>();

/**
 * The definition with its effects folded in: one object per base definition and change (so everything keyed on the
 * definition, like its compiled actions, works as it does for the base), or the definition itself when nothing changes
 * it. Scores first, then speed and hit points on them. `speedIncludesArmor` tells `movementProfileOf` heavy armor's 10 ft
 * is already taken off.
 */
export function effectiveDefinition(definition: CreatureDefinition, combatant?: CombatantState): CreatureDefinition {
  // The hot path: nothing of its own and no condition that could change it.
  if (!ownStatSources(definition).length && !(combatant?.conditions ?? []).some((condition) => condition.effects?.length || condition.modifiers)) return definition;
  const { speed, hitPoints, scores, size } = applying(definition, combatant);
  if (!speed.length && !hitPoints.length && !scores.length && !size) return definition;
  const effectsOf = (list: StatSource[]) => list.map(({ effect }) => effect);
  const key = JSON.stringify([effectsOf(speed), effectsOf(hitPoints), effectsOf(scores), size ?? null]);
  let forms = derived.get(definition);
  if (!forms) {
    forms = new Map();
    derived.set(definition, forms);
  }
  const known = forms.get(key);
  if (known) return known;
  const base = scored(definition, scores);
  const form: CreatureDefinition = { ...base, ...(size ? { size } : {}) };
  if (speed.length) {
    const { movement } = speedWith(base, speed);
    form.speed = movement.walk;
    form.movement = movement;
    form.speedIncludesArmor = true;
  }
  if (hitPoints.length) form.maxHp = hitPointsWith(base, hitPoints).maxHp;
  forms.set(key, form);
  return form;
}

/**
 * Its hit point maximum as its effects make it: what a token starts a fight with (no conditions yet), or with
 * `combatant`, what it has now (a buff's too).
 */
export function actualMaxHp(definition: CreatureDefinition, combatant?: CombatantState): number {
  return effectiveDefinition(definition, combatant).maxHp;
}

/**
 * How its hit point maximum comes about, for the sheet: "base 65, Amulet of Health (Constitution) +12, Tough +12". Empty
 * when nothing changes it.
 */
export function hitPointParts(definition: CreatureDefinition, combatant?: CombatantState): StatPart[] {
  const { hitPoints, scores } = applying(definition, combatant);
  const base = scored(definition, scores);
  const fromConstitution = base.maxHp - definition.maxHp;
  if (!hitPoints.length && !fromConstitution) return [];
  const { parts } = hitPointsWith(base, hitPoints);
  const conSource = scoresWith(definition.abilities, scores).parts.con?.slice(1).map((part) => part.label).join(", ");
  return [
    { label: "base", value: definition.maxHp },
    ...(fromConstitution ? [{ label: `${conSource ?? "Constitution"} (Constitution)`, value: fromConstitution }] : []),
    ...parts.slice(1)
  ];
}

/** How its speed comes about, for the sheet: "base 30 + Fast Movement 10 + Boots of Striding 10". Empty when nothing changes it. */
export function speedParts(definition: CreatureDefinition, combatant?: CombatantState): StatPart[] {
  const { speed, scores } = applying(definition, combatant);
  if (!speed.length) return [];
  return speedWith(scored(definition, scores), speed).parts;
}

/** How each score its effects change comes about, for the sheet: Strength "base 18, Gauntlets of Ogre Power +1". */
export function scoreParts(definition: CreatureDefinition, combatant?: CombatantState): Partial<Record<Ability, StatPart[]>> {
  const { scores } = applying(definition, combatant);
  return scores.length ? scoresWith(definition.abilities, scores).parts : {};
}
