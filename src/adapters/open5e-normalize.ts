import type { ConditionName, CreatureDefinition, DamageType, FeatureDefinition, SizeCategory, SpellDefinition, WeaponDefinition } from "@/engine";
import type { Open5eCompendiumSummary, Open5eImportedPayload } from "./open5e-client";

export function normalizeOpen5eCreature(imported: Open5eImportedPayload): CreatureDefinition {
  const raw = imported.raw;
  const name = stringField(raw, "name") ?? imported.slug;
  const documentKey = imported.documentKey ?? readNestedString(raw, ["document", "key"]) ?? "unknown";
  const sourceKey = imported.key ?? stringField(raw, "key") ?? imported.slug;
  const abilityRecord = raw.ability_scores && typeof raw.ability_scores === "object"
    ? raw.ability_scores as Record<string, unknown>
    : raw;
  const abilityScores = {
    str: numberField(abilityRecord, "strength") ?? numberField(abilityRecord, "str") ?? 10,
    dex: numberField(abilityRecord, "dexterity") ?? numberField(abilityRecord, "dex") ?? 10,
    con: numberField(abilityRecord, "constitution") ?? numberField(abilityRecord, "con") ?? 10,
    int: numberField(abilityRecord, "intelligence") ?? numberField(abilityRecord, "int") ?? 10,
    wis: numberField(abilityRecord, "wisdom") ?? numberField(abilityRecord, "wis") ?? 10,
    cha: numberField(abilityRecord, "charisma") ?? numberField(abilityRecord, "cha") ?? 10
  };

  return {
    id: `open5e:${documentKey}:${sourceKey}`,
    name,
    source: {
      provider: "open5e",
      documentKey,
      documentName: readNestedString(raw, ["document", "name"]) ?? readNestedString(raw, ["document", "title"]),
      slug: sourceKey,
      importedAt: imported.importedAt
    },
    size: normalizeSize(stringField(raw, "size") ?? readNestedString(raw, ["size", "name"])),
    armorClass: numberField(raw, "armor_class") ?? numberField(raw, "ac") ?? 10,
    maxHp: numberField(raw, "hit_points") ?? numberField(raw, "hp") ?? 1,
    speed: normalizeSpeed(raw.speed),
    abilities: abilityScores,
    saves: {},
    actions: normalizeActions(raw, documentKey, sourceKey) ?? [
      {
        kind: "unsupported",
        id: `open5e:${documentKey}:${sourceKey}:source-actions`,
        name: "Imported source actions",
        description: stringField(raw, "actions") ?? "Source text preserved; map this creature to structured actions before automation.",
        actionType: "action",
        automationSupport: "unsupported"
      }
    ]
  };
}

export function normalizeOpen5eSpell(imported: Open5eImportedPayload): SpellDefinition {
  const raw = imported.raw;
  const name = stringField(raw, "name") ?? imported.slug;
  const documentKey = imported.documentKey ?? readNestedString(raw, ["document", "key"]) ?? "unknown";
  const sourceKey = imported.key ?? stringField(raw, "key") ?? imported.slug;
  return {
    id: `open5e:${documentKey}:${sourceKey}:spell`,
    name,
    source: sourceMetadata(imported, raw),
    level: numberField(raw, "level") ?? 0,
    school: stringField(raw, "school") ?? readNestedString(raw, ["school", "name"]),
    castingTime: normalizeCastingTime(stringField(raw, "casting_time") ?? stringField(raw, "castingTime")),
    range: numberField(raw, "range") ?? 0,
    concentration: JSON.stringify(raw).toLowerCase().includes("concentration"),
    description: [
      stringField(raw, "desc"),
      stringField(raw, "higher_level"),
      stringField(raw, "material")
    ].filter(Boolean).join("\n\n"),
    automationSupport: "manual-only"
  };
}

export function normalizeOpen5eWeapon(imported: Open5eImportedPayload): WeaponDefinition | undefined {
  const raw = imported.raw;
  const weaponRecord = raw.weapon && typeof raw.weapon === "object" ? raw.weapon as Record<string, unknown> : raw;
  const name = stringField(weaponRecord, "name") ?? stringField(raw, "name") ?? imported.slug;
  const damageDice = stringField(weaponRecord, "damage_dice") ?? stringField(weaponRecord, "damage");
  if (!damageDice) {
    return undefined;
  }

  const range = numberField(weaponRecord, "range") ?? 0;
  const longRange = numberField(weaponRecord, "long_range") ?? range;
  const attackType = range > 5 ? "ranged" : "melee";
  const id = `open5e:${imported.documentKey ?? readNestedString(raw, ["document", "key"]) ?? "unknown"}:${imported.key ?? imported.slug}:weapon`;
  return {
    id,
    name,
    attackType,
    ability: attackType === "ranged" ? "dex" : "str",
    range: attackType === "ranged" ? range : 5,
    longRange: attackType === "ranged" && longRange > range ? longRange : undefined,
    reach: attackType === "melee" ? 5 : undefined,
    damage: [{
      dice: damageDice,
      damageType: normalizeDamageType(weaponRecord),
      abilityModifier: attackType === "ranged" ? "dex" : "str"
    }],
    properties: normalizeProperties(weaponRecord.properties),
    actionId: `open5e:${imported.documentKey ?? "unknown"}:${imported.key ?? imported.slug}:weapon-action`,
    source: sourceMetadata(imported, raw)
  };
}

export function normalizeOpen5eFeatureReference(input: Open5eImportedPayload | Open5eCompendiumSummary, category: "feature" | "trait" = "feature"): FeatureDefinition {
  const raw = input.raw;
  const name = "name" in input
    ? input.name
    : stringField(raw, "name") ?? input.slug;
  const documentKey = "documentKey" in input ? input.documentKey : undefined;
  const sourceKey = "objectKey" in input ? input.objectKey : input.key ?? input.slug;
  return {
    id: `open5e:${documentKey ?? readNestedString(raw, ["document", "key"]) ?? "unknown"}:${sourceKey}:feature`,
    name,
    category,
    description: "text" in input && input.text ? input.text : stringField(raw, "desc") ?? stringField(raw, "description"),
    automationSupport: "manual-only",
    source: {
      provider: "open5e",
      documentKey: documentKey ?? readNestedString(raw, ["document", "key"]),
      documentName: "documentTitle" in input ? input.documentTitle : readNestedString(raw, ["document", "name"]) ?? readNestedString(raw, ["document", "display_name"]),
      slug: sourceKey,
      importedAt: "importedAt" in input ? input.importedAt : new Date().toISOString()
    }
  };
}

export function normalizeOpen5eConditionName(name: string): ConditionName | undefined {
  const lowered = name.trim().toLowerCase();
  const supported: ConditionName[] = [
    "blinded",
    "charmed",
    "deafened",
    "frightened",
    "grappled",
    "incapacitated",
    "invisible",
    "paralyzed",
    "poisoned",
    "prone",
    "restrained",
    "stunned",
    "unconscious"
  ];
  return supported.find((condition) => condition === lowered);
}

function normalizeActions(raw: Record<string, unknown>, documentKey: string, sourceKey: string): CreatureDefinition["actions"] | undefined {
  const actions = raw.actions;
  if (!Array.isArray(actions)) {
    return undefined;
  }
  const normalized = actions.flatMap((action, actionIndex) => {
    if (!action || typeof action !== "object") return [];
    const record = action as Record<string, unknown>;
    const attacks = record.attacks;
    if (!Array.isArray(attacks) || attacks.length === 0) return [];
    return attacks.flatMap((attack, attackIndex) => {
      if (!attack || typeof attack !== "object") return [];
      const attackRecord = attack as Record<string, unknown>;
      const damageDieType = stringField(attackRecord, "damage_die_type")?.replace(/^D/i, "d").toLowerCase() ?? "d6";
      const damageDieCount = numberField(attackRecord, "damage_die_count") ?? 1;
      const damageBonus = numberField(attackRecord, "damage_bonus") ?? 0;
      const reach = numberField(attackRecord, "reach");
      const range = numberField(attackRecord, "range");
      return [{
        kind: "attack" as const,
        id: `open5e:${documentKey}:${sourceKey}:attack:${actionIndex}:${attackIndex}`,
        name: stringField(record, "name") ?? stringField(attackRecord, "name") ?? "Imported Attack",
        actionType: normalizeActionType(stringField(record, "action_type")),
        attackType: reach ? "melee" as const : "ranged" as const,
        ability: "dex" as const,
        attackBonus: numberField(attackRecord, "to_hit_mod") ?? 0,
        range: range ?? reach ?? 5,
        reach: reach ?? undefined,
        damage: [{
          dice: `${damageDieCount}${damageDieType}${damageBonus ? `${damageBonus > 0 ? "+" : ""}${damageBonus}` : ""}`,
          damageType: normalizeDamageType(attackRecord)
        }],
        automationSupport: "full" as const
      }];
    });
  });
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeActionType(value?: string): "action" | "bonus" | "reaction" {
  if (value?.toLowerCase().includes("bonus")) return "bonus";
  if (value?.toLowerCase().includes("reaction")) return "reaction";
  return "action";
}

function normalizeCastingTime(value?: string): "action" | "bonus" | "reaction" {
  const lowered = value?.toLowerCase() ?? "";
  if (lowered.includes("bonus")) return "bonus";
  if (lowered.includes("reaction")) return "reaction";
  return "action";
}

function normalizeDamageType(record: Record<string, unknown>): DamageType {
  const value = JSON.stringify(record.damage_type ?? record.extra_damage_type ?? "").toLowerCase();
  if (value.includes("fire")) return "fire";
  if (value.includes("cold")) return "cold";
  if (value.includes("poison")) return "poison";
  if (value.includes("slashing")) return "slashing";
  if (value.includes("bludgeoning")) return "bludgeoning";
  return "piercing";
}

function normalizeProperties(properties: unknown): string[] | undefined {
  if (!Array.isArray(properties)) {
    return undefined;
  }
  const names = properties.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const property = record.property && typeof record.property === "object" ? record.property as Record<string, unknown> : record;
    const name = stringField(property, "name");
    const detail = stringField(record, "detail");
    return name ? [`${name}${detail ? ` (${detail})` : ""}`] : [];
  });
  return names.length > 0 ? names : undefined;
}

function sourceMetadata(imported: Open5eImportedPayload, raw: Record<string, unknown>) {
  return {
    provider: "open5e" as const,
    documentKey: imported.documentKey ?? readNestedString(raw, ["document", "key"]),
    documentName: readNestedString(raw, ["document", "name"]) ?? readNestedString(raw, ["document", "display_name"]),
    slug: imported.key ?? imported.slug,
    importedAt: imported.importedAt
  };
}

function normalizeSize(size?: string): SizeCategory {
  const lowered = size?.toLowerCase() ?? "medium";
  if (lowered.includes("tiny")) return "tiny";
  if (lowered.includes("small")) return "small";
  if (lowered.includes("large")) return "large";
  if (lowered.includes("huge")) return "huge";
  if (lowered.includes("gargantuan")) return "gargantuan";
  return "medium";
}

function normalizeSpeed(speed: unknown): number {
  if (typeof speed === "number") {
    return speed;
  }
  if (typeof speed === "string") {
    return numberFromString(speed) ?? 30;
  }
  if (speed && typeof speed === "object") {
    const record = speed as Record<string, unknown>;
    return numberField(record, "walk") ?? numberField(record, "walking") ?? firstNumber(record) ?? 30;
  }
  return 30;
}

function numberField(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    return numberFromString(value);
  }
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === "number") return first;
    if (typeof first === "string") return numberFromString(first);
    if (first && typeof first === "object") return firstNumber(first as Record<string, unknown>);
  }
  if (value && typeof value === "object") {
    return firstNumber(value as Record<string, unknown>);
  }
  return undefined;
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n");
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>): number | undefined {
  for (const value of Object.values(record)) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = numberFromString(value);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

function numberFromString(value: string): number | undefined {
  const match = value.match(/-?\d+/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

function readNestedString(record: Record<string, unknown>, path: string[]): string | undefined {
  let value: unknown = record;
  for (const segment of path) {
    if (!value || typeof value !== "object" || !(segment in value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === "string" ? value : undefined;
}
