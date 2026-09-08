import { abilityModifier } from "./dice";
import {
  combatantExportSchema,
  creatureDefinitionSchema,
  ENCOUNTER_SCHEMA_VERSION,
  type Ability,
  type ActionDefinition,
  type CombatantExportPackage,
  type CreatureDefinition,
  type DamageComponent,
  type DamageType,
  type FeatureDefinition,
  type AreaTemplate,
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
  const spells = normalizeIdList(input.spells, "spell").map((spell) => {
    if (!isRecord(spell) || !isRecord(spell.action)) {
      return spell;
    }
    const actionType = spell.castingTime === "bonus" || spell.castingTime === "reaction" ? spell.castingTime : "action";
    const normalizedAction = normalizeAction(spell.action, 0, actionType, new Map(), featureIdByName);
    return { ...spell, action: normalizedAction };
  });
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
      automationSupport: normalizeAutomationSupport(input.automationSupport, "full")
    };
  }
  if (kind === "save") {
    return {
      ...input,
      kind,
      id: generatedId,
      name,
      actionType,
      saveAbility: normalizeAbility(input.saveAbility) ?? "dex",
      range: numberField(input, "range") ?? 60,
      damage: normalizeDamageComponents(input.damage, input.damageType),
      halfDamageOnSuccess: typeof input.halfDamageOnSuccess === "boolean" ? input.halfDamageOnSuccess : true,
      automationSupport: normalizeAutomationSupport(input.automationSupport, "full")
    };
  }
  if (kind === "area-save") {
    return {
      ...input,
      kind,
      id: generatedId,
      name,
      actionType,
      saveAbility: normalizeAbility(input.saveAbility) ?? "dex",
      range: numberField(input, "range") ?? 60,
      area: normalizeAreaTemplate(input.area),
      damage: normalizeDamageComponents(input.damage, input.damageType),
      halfDamageOnSuccess: typeof input.halfDamageOnSuccess === "boolean" ? input.halfDamageOnSuccess : true,
      affects: input.affects === "all" ? "all" : "hostile",
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
      healing: Array.isArray(input.healing) ? input.healing : [{ dice: stringField(input, "healing") ?? "1" }],
      automationSupport: normalizeAutomationSupport(input.automationSupport, "full")
    };
  }
  if (kind === "multiattack") {
    return {
      ...input,
      kind,
      id: generatedId,
      name,
      actionType: "action",
      attacks: normalizeMultiattackSteps(input.attacks, idMap),
      automationSupport: normalizeAutomationSupport(input.automationSupport, "full")
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
      automationSupport: normalizeAutomationSupport(input.automationSupport, "manual-only")
    };
  }
  return unsupportedAction(generatedId, name, actionType, stringField(input, "description") ?? JSON.stringify(input));
}

function normalizeMultiattackSteps(input: unknown, idMap: Map<string, string>): Array<{ actionId: string; count: number }> {
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
    return {
      actionId: referenced ?? `missing-action-${index + 1}`,
      count: typeof step.count === "number" ? step.count : 1
    };
  });
}

function normalizeWeapons(input: unknown, actionIdMap: Map<string, string>, abilitiesInput: unknown): WeaponDefinition[] {
  return normalizeIdList(input, "weapon").map((item) => {
    if (!isRecord(item)) {
      return item as WeaponDefinition;
    }
    const attackType = normalizeAttackType(item.attackType) ?? normalizeAttackType(item.type) ?? "melee";
    const ability = normalizeAbility(item.ability) ?? inferWeaponAbility(item, attackType, abilitiesInput);
    const range = numberField(item, "range") ?? (attackType === "ranged" ? 80 : 5);
    const magicBonus = numberField(item, "magicBonus") ?? numberField(item, "magic_bonus") ?? undefined;
    return {
      ...item,
      name: stringField(item, "name") ?? "Weapon",
      attackType,
      ability,
      range,
      longRange: numberField(item, "longRange"),
      reach: numberField(item, "reach") ?? (attackType === "melee" ? range : undefined),
      damage: normalizeDamageComponents(item.damage, item.damageType, ability),
      actionId: stringField(item, "actionId") ?? actionIdMap.get(stringField(item, "name") ?? ""),
      magicBonus
    } as WeaponDefinition;
  });
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
    dice: typeof record.dice === "number" ? String(record.dice) : stringField(record, "dice") ?? "1",
    damageType,
    abilityModifier: normalizeAbility(record.abilityModifier) ?? abilityModifierValue,
    bonusFormula: isRecord(record.bonusFormula) ? record.bonusFormula : undefined
  } as DamageComponent;
}

function normalizeAreaTemplate(input: unknown): AreaTemplate {
  if (!isRecord(input)) {
    return { type: "circle", size: 10 };
  }
  const type = input.type === "cone" || input.type === "line" || input.type === "square" ? input.type : "circle";
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

function normalizeIdList(input: unknown, prefix: string): unknown[] {
  return Array.isArray(input)
    ? input.map((item, index) => isRecord(item)
      ? { ...item, id: typeof item.id === "string" && item.id.trim() ? item.id : `${prefix}-${safeFileName(typeof item.name === "string" ? item.name : prefix)}-${index + 1}` }
      : item)
    : [];
}

function unsupportedAction(id: string, name: string, actionType: "action" | "bonus" | "reaction", description?: string): ActionDefinition {
  return {
    kind: "unsupported",
    id,
    name,
    actionType,
    description,
    automationSupport: "unsupported"
  };
}

function normalizeActionType(input: unknown, fallback: "action" | "bonus" | "reaction"): "action" | "bonus" | "reaction" {
  return input === "action" || input === "bonus" || input === "reaction" ? input : fallback;
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
