import { abilityModifier } from "./dice";
import {
  combatantExportSchema,
  creatureDefinitionSchema,
  ENCOUNTER_SCHEMA_VERSION,
  type Ability,
  type ActionDefinition,
  type ActionRider,
  type ActionType,
  type AreaTargeting,
  type CombatantExportPackage,
  type ConditionInstance,
  type ConditionName,
  type CreatureDefinition,
  type DamageComponent,
  type DamageScaling,
  type DamageType,
  type FeatureDefinition,
  type FeatureEffect,
  type HealingComponent,
  type NumericFormula,
  type ReactionMeta,
  type ReactionTrigger,
  type ResourceCost,
  type RiderDuration,
  type RiderGate,
  type RiderSave,
  type AreaTemplate,
  type SpellDefinition,
  type SpellUpcast,
  type WeaponCharges,
  type WeaponDefinition
} from "./types";

const abilities: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const damageTypes: DamageType[] = [
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder"
];

export function parseCombatantPackage(parsed: unknown): CombatantExportPackage {
  const packageInput = isRecord(parsed) && parsed.kind === "battle-sim-combatant"
    ? parsed
    : {
      kind: "battle-sim-combatant",
      schemaVersion: ENCOUNTER_SCHEMA_VERSION,
      definition: parsed
    };
  return combatantExportSchema.parse(normalizeCombatantPackage(packageInput)) as CombatantExportPackage;
}

export function normalizeCombatantPackage(input: Record<string, unknown>): Record<string, unknown> {
  const definitionInput = isRecord(input.definition) ? input.definition : {};
  const definition = normalizeCreatureDefinition(definitionInput);
  const combatant = isRecord(input.combatant)
    ? normalizeCombatantInput(input.combatant, definition)
    : undefined;
  const combatantResources = isRecord(combatant?.resources) ? normalizeResourceRecord(combatant.resources) : undefined;
  const definitionWithResources = definition.resources || !combatantResources
    ? definition
    : { ...definition, resources: combatantResources };
  return {
    ...input,
    kind: "battle-sim-combatant",
    schemaVersion: ENCOUNTER_SCHEMA_VERSION,
    definition: definitionWithResources,
    combatant
  };
}

export function normalizeCreatureDefinition(input: Record<string, unknown>): CreatureDefinition {
  const actionIdMap = new Map<string, string>();
  const features = normalizeFeatures(input.features, "feature", actionIdMap);
  const traits = normalizeFeatures(input.traits, "trait", actionIdMap);
  const featureIdByName = new Map(
    [...features, ...traits].map((feature) => [feature.name.toLowerCase(), feature.id])
  );
  const actions = normalizeActionList(input.actions, "action", actionIdMap, featureIdByName);
  const bonusActions = normalizeActionList(input.bonusActions, "bonus", actionIdMap, featureIdByName);
  const reactions = normalizeActionList(input.reactions, "reaction", actionIdMap, featureIdByName);
  const weapons = normalizeWeapons(input.weapons, actionIdMap, input.abilities);
  const spells = normalizeIdList(input.spells, "spell").map((spell) => normalizeSpellRecord(spell, featureIdByName));
  const normalized = {
    ...input,
    id: typeof input.id === "string" && input.id.trim() ? input.id : `def-${crypto.randomUUID()}`,
    saves: normalizeSaves(input.saves, input.abilities, numberField(input, "proficiencyBonus")),
    resources: normalizeResourceRecord(input.resources),
    actions,
    bonusActions,
    reactions,
    weapons,
    spells,
    features,
    traits
  };
  return creatureDefinitionSchema.parse(normalized);
}

function normalizeCombatantInput(input: Record<string, unknown>, definition: CreatureDefinition): Record<string, unknown> {
  return {
    ...input,
    displayName: typeof input.displayName === "string" && input.displayName.trim() ? input.displayName : definition.name,
    faction: input.faction === "party" || input.faction === "enemy" || input.faction === "neutral" ? input.faction : "enemy",
    position: isRecord(input.position) ? input.position : { x: 0, y: 0 },
    currentHp: typeof input.currentHp === "number" ? input.currentHp : definition.maxHp,
    tempHp: typeof input.tempHp === "number" ? input.tempHp : 0,
    resources: normalizeResourceRecord(input.resources),
    state: typeof input.state === "string" ? input.state : "active",
    tacticsProfile: normalizeTacticsProfile(input.tacticsProfile)
  };
}

function normalizeResourceRecord(input: unknown): Record<string, number> | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const entries = Object.entries(input)
    .filter((entry): entry is [string, number] => entry[0].trim() !== "" && typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .map(([resourceId, value]) => [resourceId.trim(), Math.max(0, Math.floor(value))] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeActionList(
  input: unknown,
  fallbackActionType: "action" | "bonus" | "reaction",
  idMap: Map<string, string>,
  featureIdByName: Map<string, string>
): ActionDefinition[] {
  return Array.isArray(input)
    ? input.map((action, index) => normalizeAction(action, index, fallbackActionType, idMap, featureIdByName))
    : [];
}

function normalizeAction(
  input: unknown,
  index: number,
  fallbackActionType: "action" | "bonus" | "reaction",
  idMap: Map<string, string>,
  featureIdByName: Map<string, string>
): ActionDefinition {
  if (!isRecord(input)) {
    return unsupportedAction(`unsupported-${fallbackActionType}-${index + 1}`, "Unsupported Action", fallbackActionType);
  }
  const previousId = stringField(input, "id");
  const name = stringField(input, "name") ?? "Action";
  const generatedId = previousId ?? `${fallbackActionType}-${safeFileName(name)}-${index + 1}`;
  const actionType = normalizeActionType(input.actionType, fallbackActionType);
  if (previousId) {
    idMap.set(previousId, generatedId);
  }
  idMap.set(name, generatedId);

  const kind = input.kind === "feature" ? "activate-feature" : input.kind;
  if (kind === "attack") {
    const attackType = normalizeAttackType(input.attackType) ?? "melee";
    const ability = normalizeAbility(input.ability) ?? (attackType === "ranged" ? "dex" : "str");
    return {
      ...input,
      kind,
      id: generatedId,
      name,
      actionType,
      attackType,
      ability,
      range: numberField(input, "range") ?? (attackType === "ranged" ? 80 : 5),
      longRange: numberField(input, "longRange"),
      reach: numberField(input, "reach") ?? (attackType === "melee" ? 5 : undefined),
      damage: normalizeDamageComponents(input.damage, input.damageType, attackType === "spell" ? undefined : ability),
      attackDelivery: input.attackDelivery === "beams" ? "beams" : input.attackDelivery === "single" ? "single" : undefined,
      beamCount: numberField(input, "beamCount"),
      beamCountByLevel: normalizeBeamCountByLevel(input.beamCountByLevel),
      autoHit: input.autoHit === true ? true : undefined,
      riders: normalizeRiders(input.riders, "on-hit"),
      reaction: normalizeReactionMeta(input.reaction),
      concentration: input.concentration === true ? true : undefined,
      automationSupport: normalizeAutomationSupport(input.automationSupport, "full")
    };
  }
  if (kind === "save") {
    const onSuccess = normalizeOnSuccess(input.onSuccess, input.halfDamageOnSuccess);
    return {
      ...input,
      kind,
      id: generatedId,
      name,
      actionType,
      saveAbility: normalizeAbility(input.saveAbility) ?? "dex",
      range: numberField(input, "range") ?? 60,
      damage: normalizeDamageComponents(input.damage, input.damageType),
      halfDamageOnSuccess: onSuccess === "half",
      onSuccess,
      targeting: normalizeSelfTargeting(input.targeting),
      riders: normalizeRiders(input.riders, "on-save-fail"),
      reaction: normalizeReactionMeta(input.reaction),
      concentration: input.concentration === true ? true : undefined,
      automationSupport: normalizeAutomationSupport(input.automationSupport, "full")
    };
  }
  if (kind === "area-save") {
    const onSuccess = normalizeOnSuccess(input.onSuccess, input.halfDamageOnSuccess);
    return {
      ...input,
      kind,
      id: generatedId,
      name,
      actionType,
      saveAbility: normalizeAbility(input.saveAbility) ?? "dex",
      range: numberField(input, "range") ?? 60,
      area: normalizeAreaTemplate(input.area),
      targeting: normalizeAreaTargeting(input.targeting),
      damage: normalizeDamageComponents(input.damage, input.damageType),
      halfDamageOnSuccess: onSuccess === "half",
      onSuccess,
      affects: input.affects === "all" ? "all" : "hostile",
      riders: normalizeRiders(input.riders, "on-save-fail"),
      reaction: normalizeReactionMeta(input.reaction),
      concentration: input.concentration === true ? true : undefined,
      automationSupport: normalizeAutomationSupport(input.automationSupport, "full")
    };
  }
  if (kind === "healing") {
    return {
      ...input,
      kind,
      id: generatedId,
      name,
      actionType,
      range: numberField(input, "range") ?? 60,
      healing: normalizeHealingComponents(Array.isArray(input.healing) ? input.healing : (stringField(input, "healing") ?? "1")),
      targeting: normalizeSelfTargeting(input.targeting),
      riders: normalizeRiders(input.riders, "always"),
      automationSupport: normalizeAutomationSupport(input.automationSupport, "full")
    };
  }
  if (kind === "multiattack") {
    return {
      ...input,
      kind,
      id: generatedId,
      name,
      actionType,
      attacks: normalizeMultiattackSteps(input.attacks, idMap),
      automationSupport: normalizeAutomationSupport(input.automationSupport, "full")
    };
  }
  if (kind === "utility") {
    const mode = input.mode === "disengage" || input.mode === "dodge" || input.mode === "hide" || input.mode === "help"
      ? input.mode
      : "dash";
    const automatable = mode !== "hide" && mode !== "help" && input.automationSupport !== "partial";
    return {
      ...input,
      kind,
      id: generatedId,
      name,
      actionType: actionType === "bonus" ? "bonus" : "action",
      mode,
      resourceCost: normalizeResourceCost(input.resourceCost),
      automationSupport: automatable ? "full" : "partial"
    };
  }
  if (kind === "activate-feature") {
    return {
      ...input,
      kind,
      id: generatedId,
      name,
      actionType,
      featureId: stringField(input, "featureId") ?? featureIdByName.get(name.toLowerCase()) ?? previousId ?? generatedId,
      reaction: normalizeReactionMeta(input.reaction),
      automationSupport: normalizeAutomationSupport(input.automationSupport, "manual-only")
    };
  }
  return unsupportedAction(generatedId, name, actionType, stringField(input, "description") ?? JSON.stringify(input));
}

function normalizeMultiattackSteps(
  input: unknown,
  idMap: Map<string, string>
): Array<{ actionId: string; count: number; targetGroup?: number }> {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((step, index) => {
    if (!isRecord(step)) {
      return { actionId: `missing-action-${index + 1}`, count: 1 };
    }
    const referenced = typeof step.actionId === "string"
      ? idMap.get(step.actionId) ?? step.actionId
      : typeof step.actionName === "string"
        ? idMap.get(step.actionName)
        : undefined;
    const targetGroup = numberField(step, "targetGroup");
    return {
      actionId: referenced ?? `missing-action-${index + 1}`,
      count: typeof step.count === "number" ? step.count : 1,
      targetGroup: targetGroup !== undefined && targetGroup > 0 ? Math.floor(targetGroup) : undefined
    };
  });
}

function normalizeWeapons(input: unknown, actionIdMap: Map<string, string>, abilitiesInput: unknown): WeaponDefinition[] {
  return normalizeIdList(input, "weapon").map((item) => {
    if (!isRecord(item)) {
      return item as WeaponDefinition;
    }
    const attackType = normalizeAttackType(item.attackType) ?? normalizeAttackType(item.type) ?? "melee";
    const attackAttackType = attackType === "spell" ? "ranged" : attackType;
    const ability = normalizeWeaponAbility(item.ability) ?? inferWeaponAbility(item, attackType, abilitiesInput);
    const damageAbility = ability === "finesse" ? undefined : ability;
    const range = numberField(item, "range") ?? (attackType === "ranged" ? 80 : 5);
    const magicBonus = numberField(item, "magicBonus") ?? numberField(item, "magic_bonus") ?? undefined;
    return {
      ...item,
      name: stringField(item, "name") ?? "Weapon",
      category: item.category === "simple" || item.category === "martial" ? item.category : undefined,
      attackType: attackAttackType,
      ability,
      proficient: item.proficient === false ? false : undefined,
      magical: item.magical === true ? true : undefined,
      toHitBonus: numberField(item, "toHitBonus"),
      range,
      longRange: numberField(item, "longRange"),
      reach: numberField(item, "reach") ?? (attackAttackType === "melee" ? range : undefined),
      damage: normalizeDamageComponents(item.damage, item.damageType, damageAbility),
      versatileDamage: Array.isArray(item.versatileDamage)
        ? normalizeDamageComponents(item.versatileDamage, item.damageType, damageAbility)
        : undefined,
      charges: normalizeWeaponCharges(item.charges),
      resourceCost: normalizeResourceCost(item.resourceCost),
      onHit: normalizeRiders(item.onHit, "on-hit"),
      actionId: stringField(item, "actionId") ?? actionIdMap.get(stringField(item, "name") ?? ""),
      magicBonus,
      usableAs: normalizeUsableAs(item.usableAs),
      grip: normalizeWeaponGrip(item),
      powerAttack: item.powerAttack === true ? true : undefined,
      reactionTrigger: normalizeReactionTrigger(item.reactionTrigger)
    } as WeaponDefinition;
  });
}

function normalizeWeaponAbility(input: unknown): Ability | "finesse" | undefined {
  return input === "finesse" ? "finesse" : normalizeAbility(input);
}

/** Explicit `grip`, else derive it from the weapon's `properties` (`versatile` / `two-handed`). */
function normalizeWeaponGrip(item: Record<string, unknown>): WeaponDefinition["grip"] {
  if (item.grip === "two-handed" || item.grip === "versatile" || item.grip === "one-handed") {
    return item.grip;
  }
  const properties = Array.isArray(item.properties) ? item.properties.map((p) => String(p).toLowerCase()) : [];
  if (properties.includes("versatile")) return "versatile";
  if (properties.includes("two-handed")) return "two-handed";
  return undefined;
}

function normalizeUsableAs(input: unknown): Array<"action" | "bonus" | "reaction"> | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const slots = [...new Set(input.filter(
    (slot): slot is "action" | "bonus" | "reaction" => slot === "action" || slot === "bonus" || slot === "reaction"
  ))];
  return slots.length > 0 ? slots : undefined;
}

/**
 * Normalize a single weapon record — the SRD-library / builder entry point.
 * `abilities` is only consulted to break a finesse tie when `ability` is absent.
 */
export function normalizeWeaponDefinition(input: unknown, abilities?: CreatureDefinition["abilities"]): WeaponDefinition {
  return normalizeWeapons([input], new Map(), abilities)[0] as WeaponDefinition;
}

/** Normalize a single action record — the builder entry point for innate / monster actions. */
export function normalizeActionDefinition(
  input: unknown,
  fallbackActionType: "action" | "bonus" | "reaction" = "action"
): ActionDefinition {
  return normalizeAction(input, 0, fallbackActionType, new Map(), new Map());
}

/** Normalize a single spell record — the SRD-library / builder entry point. */
export function normalizeSpellDefinition(
  input: unknown,
  featureIdByName: Map<string, string> = new Map()
): SpellDefinition {
  const normalized = normalizeSpellRecord(input, featureIdByName);
  if (isRecord(normalized) && (typeof normalized.id !== "string" || !normalized.id.trim())) {
    normalized.id = `spell-${safeFileName(typeof normalized.name === "string" ? normalized.name : "spell")}`;
  }
  return normalized as SpellDefinition;
}

function normalizeSpellRecord(input: unknown, featureIdByName: Map<string, string>): unknown {
  if (!isRecord(input)) {
    return input;
  }
  const normalized: Record<string, unknown> = {
    ...input,
    ritual: input.ritual === true ? true : undefined,
    concentration: typeof input.concentration === "boolean" ? input.concentration : undefined,
    range: normalizeSpellRange(input.range),
    components: normalizeSpellComponents(input.components),
    upcast: normalizeSpellUpcast(input.upcast)
  };
  if (isRecord(input.action)) {
    const actionType = input.castingTime === "bonus" || input.castingTime === "reaction" ? input.castingTime : "action";
    normalized.action = normalizeAction(input.action, 0, actionType, new Map(), featureIdByName);
  }
  return normalized;
}

function normalizeWeaponCharges(input: unknown): WeaponCharges | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const id = stringField(input, "id");
  const max = numberField(input, "max");
  if (!id || max === undefined || max <= 0) {
    return undefined;
  }
  let recharge: WeaponCharges["recharge"];
  if (input.recharge === "dawn" || input.recharge === "short-rest" || input.recharge === "long-rest") {
    recharge = input.recharge;
  } else if (isRecord(input.recharge) && typeof input.recharge.dice === "string" && input.recharge.dice.trim()) {
    recharge = { dice: input.recharge.dice.trim() };
  }
  return { id, max: Math.floor(max), recharge };
}

function inferWeaponAbility(item: Record<string, unknown>, attackType: "melee" | "ranged" | "spell", abilitiesInput: unknown): Ability {
  if (attackType === "ranged" || attackType === "spell") {
    return "dex";
  }
  const properties = Array.isArray(item.properties)
    ? item.properties.map((property) => String(property).toLowerCase())
    : [];
  if (properties.includes("finesse") && isRecord(abilitiesInput)) {
    const str = typeof abilitiesInput.str === "number" ? abilitiesInput.str : 10;
    const dex = typeof abilitiesInput.dex === "number" ? abilitiesInput.dex : 10;
    return dex > str ? "dex" : "str";
  }
  return "str";
}

function normalizeFeatures(input: unknown, prefix: "feature" | "trait", idMap: Map<string, string>): FeatureDefinition[] {
  return normalizeIdList(input, prefix).map((feature) => {
    if (!isRecord(feature)) {
      return feature as FeatureDefinition;
    }
    const name = stringField(feature, "name") ?? prefix;
    const id = stringField(feature, "id") ?? `${prefix}-${safeFileName(name)}`;
    if (id) idMap.set(id, id);
    idMap.set(name, id);
    return {
      ...feature,
      id,
      name,
      category: normalizeFeatureCategory(feature.category, prefix),
      grantedActions: normalizeActionList(feature.grantedActions, "action", idMap, new Map()),
      automationSupport: normalizeAutomationSupport(feature.automationSupport, "manual-only")
    } as FeatureDefinition;
  });
}

function normalizeSaves(input: unknown, abilitiesInput: unknown, proficiencyBonus = 2): CreatureDefinition["saves"] | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const scores = isRecord(abilitiesInput) ? abilitiesInput : {};
  const saves: Partial<Record<Ability, number>> = {};
  for (const ability of abilities) {
    const value = input[ability];
    if (typeof value === "number" && Number.isFinite(value)) {
      saves[ability] = value;
    } else if (isRecord(value)) {
      const score = typeof scores[ability] === "number" ? scores[ability] : 10;
      const base = numberField(value, "base") ?? numberField(value, "bonus") ?? 0;
      const proficiency = value.proficiency === true ? proficiencyBonus : 0;
      saves[ability] = abilityModifier(score) + proficiency + base;
    }
  }
  return Object.keys(saves).length > 0 ? saves : undefined;
}

function normalizeDamageComponents(input: unknown, fallbackDamageType: unknown, abilityModifierValue?: Ability): DamageComponent[] {
  if (Array.isArray(input)) {
    return input.map((component) => normalizeDamageComponent(component, fallbackDamageType, abilityModifierValue));
  }
  return [normalizeDamageComponent({ dice: input }, fallbackDamageType, abilityModifierValue)];
}

function normalizeDamageComponent(input: unknown, fallbackDamageType: unknown, abilityModifierValue?: Ability): DamageComponent {
  const record = isRecord(input) ? input : { dice: input };
  const damageType = normalizeDamageType(record.damageType) ?? normalizeDamageType(fallbackDamageType) ?? "slashing";
  return {
    ...record,
    ...syncDiceSugar(record),
    damageType,
    abilityModifier: normalizeAbility(record.abilityModifier) ?? abilityModifierValue,
    bonusFormula: isRecord(record.bonusFormula) ? record.bonusFormula : undefined,
    magical: record.magical === true ? true : undefined,
    scaling: normalizeDamageScaling(record.scaling)
  } as DamageComponent;
}

function normalizeHealingComponents(input: unknown): HealingComponent[] {
  const list = Array.isArray(input) ? input : [input];
  return list.map((component) => {
    const record: Record<string, unknown> = isRecord(component) ? component : { dice: component };
    return {
      ...record,
      ...syncDiceSugar(record),
      abilityModifier: normalizeAbility(record.abilityModifier)
    } as HealingComponent;
  });
}

/**
 * Keep `dice` (canonical) and `diceCount` / `diceSize` / `flatBonus` (structured)
 * in step: structured → `dice` when `dice` is absent, `dice` → structured when it
 * is a clean `NdM(+K)` form. Non-conforming expressions ("6", "2d6+1d4") keep
 * `dice` and leave the structured mirror unset.
 */
function syncDiceSugar(record: Record<string, unknown>): { dice: string; diceCount?: number; diceSize?: number; flatBonus?: number } {
  let count = numberField(record, "diceCount");
  let size = numberField(record, "diceSize");
  let flat = numberField(record, "flatBonus");

  let dice = typeof record.dice === "number"
    ? String(record.dice)
    : (typeof record.dice === "string" && record.dice.trim() ? record.dice.trim() : undefined);

  if (!dice && count !== undefined && size !== undefined) {
    dice = `${count}d${size}${flat ? (flat > 0 ? `+${flat}` : String(flat)) : ""}`;
  }
  dice = (dice ?? "1").replace(/\s+/g, "");

  if (count === undefined || size === undefined) {
    const match = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(dice);
    if (match) {
      count = count ?? Number(match[1]);
      size = size ?? Number(match[2]);
      if (flat === undefined && match[3]) {
        flat = Number(match[3]);
      }
    }
  }

  const result: { dice: string; diceCount?: number; diceSize?: number; flatBonus?: number } = { dice };
  if (count !== undefined) result.diceCount = count;
  if (size !== undefined) result.diceSize = size;
  if (flat !== undefined) result.flatBonus = flat;
  return result;
}

function normalizeDamageScaling(input: unknown): DamageScaling | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  if (input.mode === "cantrip-by-level" && Array.isArray(input.steps)) {
    const steps = input.steps
      .filter(isRecord)
      .map((step) => ({ atLevel: numberField(step, "atLevel") ?? 1, dice: (stringField(step, "dice") ?? "1").replace(/\s+/g, "") }))
      .sort((a, b) => a.atLevel - b.atLevel);
    return steps.length ? { mode: "cantrip-by-level", steps } : undefined;
  }
  if (input.mode === "per-slot-above-base") {
    const dice = stringField(input, "dice");
    return dice ? { mode: "per-slot-above-base", dice: dice.replace(/\s+/g, "") } : undefined;
  }
  return undefined;
}

function normalizeAreaTemplate(input: unknown): AreaTemplate {
  if (!isRecord(input)) {
    return { type: "circle", size: 10 };
  }
  const type = input.type === "cone" || input.type === "line" || input.type === "square" || input.type === "rectangle" ? input.type : "circle";
  const direction = input.direction === "north" || input.direction === "east" || input.direction === "south" || input.direction === "west"
    ? input.direction
    : undefined;
  return {
    type,
    size: numberField(input, "size") ?? 10,
    width: numberField(input, "width"),
    direction
  };
}

const RIDER_GATES: RiderGate[] = ["always", "on-hit", "on-miss", "on-crit", "on-save-fail", "on-save-success"];
const CONDITION_NAMES: ConditionName[] = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated",
  "invisible", "paralyzed", "poisoned", "prone", "restrained", "stunned", "unconscious", "custom"
];

function normalizeRiders(input: unknown, defaultGate: RiderGate): ActionRider[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const riders = input
    .map((rider, index) => normalizeRider(rider, defaultGate, index))
    .filter((rider): rider is ActionRider => rider !== null);
  return riders.length ? riders : undefined;
}

function normalizeRider(input: unknown, defaultGate: RiderGate, index: number): ActionRider | null {
  if (!isRecord(input)) {
    return null;
  }
  const id = stringField(input, "id") ?? `rider-${index + 1}`;
  const oncePerTurn = input.oncePerTurn === true ? true : undefined;

  if (input.kind === "note") {
    return { kind: "note", id, oncePerTurn, text: stringField(input, "text") ?? "" };
  }

  const when = normalizeRiderGate(input.when) ?? defaultGate;
  const resourceCost = normalizeResourceCost(input.resourceCost);
  const base = { id, oncePerTurn, when, resourceCost };

  if (input.kind === "damage") {
    return { ...base, kind: "damage", components: normalizeDamageComponents(input.components, input.damageType) };
  }
  if (input.kind === "healing") {
    return {
      ...base,
      kind: "healing",
      components: normalizeHealingComponents(input.components ?? "1"),
      target: input.target === "self" ? "self" : input.target === "target" ? "target" : undefined
    };
  }
  if (input.kind === "push") {
    return { ...base, kind: "push", distance: numberField(input, "distance") ?? 5 };
  }
  if (input.kind === "condition") {
    const condition = isRecord(input.condition) && typeof input.condition.custom === "string"
      ? { custom: input.condition.custom }
      : normalizeConditionName(input.condition) ?? "restrained";
    return {
      ...base,
      kind: "condition",
      condition,
      duration: normalizeRiderDuration(input.duration),
      save: normalizeRiderSave(input.save),
      modifiers: isRecord(input.modifiers) ? input.modifiers as ConditionInstance["modifiers"] : undefined,
      effects: Array.isArray(input.effects) ? input.effects as FeatureEffect[] : undefined
    };
  }
  return null;
}

function normalizeRiderGate(input: unknown): RiderGate | undefined {
  return typeof input === "string" && RIDER_GATES.includes(input as RiderGate) ? input as RiderGate : undefined;
}

function normalizeConditionName(input: unknown): ConditionName | undefined {
  return typeof input === "string" && CONDITION_NAMES.includes(input as ConditionName) ? input as ConditionName : undefined;
}

function normalizeRiderDuration(input: unknown): RiderDuration {
  if (typeof input === "number" && Number.isFinite(input)) {
    return { kind: "rounds", rounds: Math.max(0, Math.floor(input)) };
  }
  if (isRecord(input)) {
    if (input.kind === "save-ends" || input.untilSaveEnds === true) {
      return { kind: "save-ends", saveAt: input.saveAt === "turn-start" ? "turn-start" : "turn-end" };
    }
    if (input.kind === "concentration" || input.concentration === true) {
      return { kind: "concentration" };
    }
    if (input.kind === "permanent" || input.permanent === true) {
      return { kind: "permanent" };
    }
    if (input.kind === "until-start-of-next-turn" || input.untilStartOfNextTurn === true) {
      return { kind: "until-start-of-next-turn" };
    }
    const rounds = numberField(input, "rounds") ?? numberField(input, "durationRounds");
    if (input.kind === "rounds" || rounds !== undefined) {
      const repeatSaveAt = input.repeatSaveAt === "turn-start" ? "turn-start"
        : input.repeatSaveAt === "turn-end" ? "turn-end"
        : undefined;
      return repeatSaveAt
        ? { kind: "rounds", rounds: rounds ?? 1, repeatSaveAt }
        : { kind: "rounds", rounds: rounds ?? 1 };
    }
  }
  return { kind: "rounds", rounds: 1 };
}

function normalizeReactionTrigger(input: unknown): ReactionTrigger | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  switch (input.kind) {
    case "enemy-leaves-reach":
      return { kind: "enemy-leaves-reach" };
    case "targeted-by-attack":
      return { kind: "targeted-by-attack", meleeOnly: input.meleeOnly === true ? true : undefined };
    case "hit-by-attack":
      return { kind: "hit-by-attack", meleeOnly: input.meleeOnly === true ? true : undefined };
    case "ally-targeted-by-attack":
      return { kind: "ally-targeted-by-attack", withinFt: numberField(input, "withinFt") ?? 5 };
    case "enemy-casts-spell":
      return {
        kind: "enemy-casts-spell",
        withinFt: numberField(input, "withinFt") ?? 60,
        maxSpellLevel: numberField(input, "maxSpellLevel")
      };
    case "manual":
      return { kind: "manual", note: stringField(input, "note") ?? "" };
    default:
      return undefined;
  }
}

function normalizeReactionMeta(input: unknown): ReactionMeta | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const trigger = normalizeReactionTrigger(input.trigger);
  if (!trigger) {
    return undefined;
  }
  const target = input.target === "self" || input.target === "trigger-target" || input.target === "trigger-source"
    ? input.target
    : undefined;
  const priority = input.priority === "always" || input.priority === "manual" || input.priority === "worthwhile"
    ? input.priority
    : undefined;
  return { trigger, target, priority };
}

function normalizeRiderSave(input: unknown): RiderSave | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const ability = normalizeAbility(input.ability);
  if (!ability) {
    return undefined;
  }
  return {
    ability,
    dc: numberField(input, "dc"),
    dcFormula: isRecord(input.dcFormula) ? input.dcFormula as NumericFormula : undefined,
    onSuccess: input.onSuccess === "ends-early" ? "ends-early" : "negates"
  };
}

function normalizeResourceCost(input: unknown): ResourceCost | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const resourceId = stringField(input, "resourceId");
  if (!resourceId) {
    return undefined;
  }
  const amount = numberField(input, "amount") ?? 1;
  return { resourceId, amount: Math.max(1, Math.floor(amount)) };
}

function normalizeOnSuccess(input: unknown, legacyHalfDamage: unknown): "half" | "none" | "negates" {
  if (input === "half" || input === "none" || input === "negates") {
    return input;
  }
  return legacyHalfDamage === false ? "none" : "half";
}

function normalizeSelfTargeting(input: unknown): { target: "single" | "self" } | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  return { target: input.target === "self" ? "self" : "single" };
}

function normalizeAreaTargeting(input: unknown): AreaTargeting | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  return {
    origin: input.origin === "self" ? "self" : "point",
    aimedFromSelf: input.aimedFromSelf === true ? true : undefined,
    range: numberField(input, "range") ?? 0
  };
}

function normalizeBeamCountByLevel(input: unknown): Array<{ atLevel: number; count: number }> | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const steps = input
    .filter(isRecord)
    .map((step) => ({ atLevel: numberField(step, "atLevel") ?? 1, count: numberField(step, "count") ?? 1 }))
    .sort((a, b) => a.atLevel - b.atLevel);
  return steps.length ? steps : undefined;
}

function normalizeSpellRange(input: unknown): number | "self" | "touch" {
  if (input === "self" || input === "touch") {
    return input;
  }
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }
  if (typeof input === "string") {
    const lowered = input.toLowerCase();
    if (lowered.includes("self")) return "self";
    if (lowered.includes("touch")) return "touch";
    const parsed = Number.parseInt(input, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeSpellComponents(input: unknown): { v?: boolean; s?: boolean; m?: string } | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const components: { v?: boolean; s?: boolean; m?: string } = {};
  if (input.v === true) components.v = true;
  if (input.s === true) components.s = true;
  if (typeof input.m === "string" && input.m.trim()) components.m = input.m.trim();
  return Object.keys(components).length ? components : undefined;
}

function normalizeSpellUpcast(input: unknown): SpellUpcast | undefined {
  if (!isRecord(input) || !isRecord(input.perSlotAboveBase)) {
    return undefined;
  }
  const source = input.perSlotAboveBase;
  const perSlot: NonNullable<SpellUpcast["perSlotAboveBase"]> = {};
  const damageDice = stringField(source, "damageDice");
  if (damageDice) perSlot.damageDice = damageDice.replace(/\s+/g, "");
  const beams = numberField(source, "beams");
  if (beams !== undefined) perSlot.beams = beams;
  const targets = numberField(source, "targets");
  if (targets !== undefined) perSlot.targets = targets;
  const areaSize = numberField(source, "areaSize");
  if (areaSize !== undefined) perSlot.areaSize = areaSize;
  return Object.keys(perSlot).length ? { perSlotAboveBase: perSlot } : undefined;
}

function normalizeIdList(input: unknown, prefix: string): unknown[] {
  return Array.isArray(input)
    ? input.map((item, index) => isRecord(item)
      ? { ...item, id: typeof item.id === "string" && item.id.trim() ? item.id : `${prefix}-${safeFileName(typeof item.name === "string" ? item.name : prefix)}-${index + 1}` }
      : item)
    : [];
}

function unsupportedAction(id: string, name: string, actionType: ActionType, description?: string): ActionDefinition {
  return {
    kind: "unsupported",
    id,
    name,
    actionType,
    description,
    automationSupport: "unsupported"
  };
}

function normalizeActionType(
  input: unknown,
  fallback: "action" | "bonus" | "reaction"
): "action" | "bonus" | "reaction" | "free" {
  return input === "action" || input === "bonus" || input === "reaction" || input === "free" ? input : fallback;
}

function normalizeAttackType(input: unknown): "melee" | "ranged" | "spell" | undefined {
  const value = typeof input === "string" ? input.toLowerCase() : "";
  if (value.includes("spell")) return "spell";
  if (value.includes("ranged")) return "ranged";
  if (value.includes("melee")) return "melee";
  return undefined;
}

function normalizeAbility(input: unknown): Ability | undefined {
  return typeof input === "string" && abilities.includes(input as Ability) ? input as Ability : undefined;
}

function normalizeDamageType(input: unknown): DamageType | undefined {
  return typeof input === "string" && damageTypes.includes(input as DamageType) ? input as DamageType : undefined;
}

function normalizeFeatureCategory(input: unknown, fallback: "feature" | "trait"): "feature" | "trait" {
  if (input === "trait") return "trait";
  if (input === "feature" || input === "class-feature" || input === "class feature") return "feature";
  return fallback;
}

function normalizeAutomationSupport(input: unknown, fallback: "full" | "partial" | "manual-only" | "unsupported"): "full" | "partial" | "manual-only" | "unsupported" {
  return input === "full" || input === "partial" || input === "manual-only" || input === "unsupported" ? input : fallback;
}

function normalizeTacticsProfile(input: unknown): "basic-melee" | "basic-ranged" | "skirmisher" | "brute" | "defender" | "controller" {
  return input === "basic-ranged"
    || input === "skirmisher"
    || input === "brute"
    || input === "defender"
    || input === "controller"
    ? input
    : "basic-melee";
}

function numberField(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function safeFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "combatant";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
