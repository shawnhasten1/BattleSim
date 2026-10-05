import type { Ability, ActionDefinition, FeatureDefinition, FeatureEffect } from "@/engine";
import type { ChoiceSpec, FeatureGrant, PickOption, SpellcastingProgression } from "@/lib/character-builder/catalog";
import { srd52Source, srdClass, srdFeat, srdFeatText, srdFeature, srdFeatureText, srdNumbers, srdTraitText } from "./reference";

/**
 * Small helpers for writing the 2024 catalog. A feature's name and description come from the SRD 5.2 reference
 * (`srdFeature`), so the catalog only says what runs. Ids here are placeholders: the builder gives each feature on an
 * actor an id of its own (`builtFeatureId`).
 */

const PREFIX = "srd-2024_";
const refKey = (key: string) => (key.startsWith(PREFIX) ? key : `${PREFIX}${key}`);

interface FeatureOptions {
  name?: string;
  effects?: FeatureEffect[];
  grantedActions?: ActionDefinition[];
  aura?: FeatureDefinition["aura"];
  /** What the simulator doesn't run of it, appended to the SRD text. */
  notSimulated?: string;
  automationSupport?: FeatureDefinition["automationSupport"];
}

/** Where a feature's name and text come from: a class or subclass feature, a feat, or a species trait. */
type Origin = string | { feat: string } | { species: string; trait: string };

function origin(from: Origin): { id: string; name: string; text: string; slug: string } {
  if (typeof from === "string") {
    const reference = srdFeature(from);
    return { id: reference.key.slice(PREFIX.length), name: reference.name, text: srdFeatureText(from), slug: reference.key };
  }
  if ("feat" in from) {
    const feat = srdFeat(from.feat);
    return { id: feat.key.slice(PREFIX.length), name: feat.name, text: srdFeatText(from.feat), slug: feat.key };
  }
  const slug = `${refKey(from.species)}:${from.trait}`;
  return { id: from.trait.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: from.trait, text: srdTraitText(from.species, from.trait), slug };
}

function base(from: Origin, options: FeatureOptions): FeatureDefinition {
  const { id, name, text, slug } = origin(from);
  return {
    id,
    name: options.name ?? name,
    category: typeof from === "object" && "species" in from ? "trait" : "feature",
    source: srd52Source(slug),
    description: options.notSimulated ? `${text}\n\nNot simulated: ${options.notSimulated}` : text,
    automationSupport: options.automationSupport ?? "full",
    ...(options.effects ? { effects: options.effects } : {}),
    ...(options.grantedActions ? { grantedActions: options.grantedActions } : {}),
    ...(options.aura ? { aura: options.aura } : {})
  };
}

/** A feature that runs (`full`), or runs in part (`partial`, with what doesn't said in `notSimulated`). */
export function runs(key: Origin, options: FeatureOptions = {}): FeatureDefinition {
  return base(key, { ...options, automationSupport: options.automationSupport ?? (options.notSimulated ? "partial" : "full") });
}

/** A feature the engine can't run yet: on the actor as the SRD's text for the DM (`manual-only`). */
export function reference(key: Origin, options: Omit<FeatureOptions, "effects" | "grantedActions" | "automationSupport"> = {}): FeatureDefinition {
  return base(key, { ...options, automationSupport: "manual-only" });
}

/** A feature with nothing to do in a fight (rests, exploration, checks): shown, never counted as a gap. */
export function informational(key: Origin, options: { name?: string } = {}): FeatureDefinition {
  return { ...base(key, { ...options, automationSupport: "manual-only" }), informational: true };
}

/** A grant of a feature, keyed and tied to the SRD feature it covers. */
export function grant(key: string, feature: FeatureDefinition, extra: Omit<FeatureGrant, "key" | "feature" | "ref"> = {}): FeatureGrant {
  const slug = feature.source?.slug ?? key;
  // A class feature's grant covers its SRD feature; a feat's or a trait's grant has nothing to cover in the class lists.
  return { key, ...(slug.includes(":") || !srdFeatureExists(slug) ? {} : { ref: refKey(slug) }), feature, ...extra };
}

function srdFeatureExists(key: string): boolean {
  try {
    srdFeature(key);
    return true;
  } catch {
    return false;
  }
}

/** A choice tied to the SRD feature it covers ("Ability Score Improvement", "Fighter Subclass"). */
export function choice<C extends ChoiceSpec>(spec: C, ref: string): C & { ref: string } {
  return { ...spec, ref: refKey(ref) };
}

/** A class's Weapon Mastery feature: the builder fills in the kinds of weapon chosen (`weapon-mastery` effect). */
export function weaponMasteryFeature(key: string): FeatureDefinition {
  return runs(key, { effects: [{ kind: "weapon-mastery", weapons: [] }] });
}

/** 20 values from a sparse "from level N, value V" list: `fromLevels([[2, 1], [17, 2]])` → null, 1 … 1, 2, 2, 2, 2. */
export function fromLevels(steps: Array<[number, number]>): Array<number | null> {
  return Array.from({ length: 20 }, (_, index) => {
    let value: number | null = null;
    for (const [level, amount] of steps) if (index + 1 >= level) value = amount;
    return value;
  });
}

/** A 2024 library spell's id: `spell("fireball")` → `srd:spell:fireball-2024`. */
export const spell = (slug: string) => `srd:spell:${slug}-2024`;

/** A class's spellcasting from its SRD table: its cantrips and prepared spells by level, its own list. */
export function srdSpellcasting(classKey: string, ability: Ability, kind: SpellcastingProgression["kind"], extra: Partial<SpellcastingProgression> = {}): SpellcastingProgression {
  const hasCantrips = srdClass(classKey).columns.some((column) => column.id === "cantrips");
  return {
    ability,
    kind,
    list: classKey,
    ...(hasCantrips ? { cantrips: srdNumbers(classKey, "cantrips") } : {}),
    prepared: srdNumbers(classKey, "prepared-spells"),
    ...extra
  };
}

/**
 * The options an SRD option list describes ("### Careful Spell" …), each as a `pick` option that puts its text on the
 * actor as a reference feature named `<prefix>: <option>`. For lists of options the engine can't run yet (Metamagic).
 */
export function srdReferenceOptions(key: string, prefix: string): PickOption[] {
  const feature = srdFeature(key);
  const sections = feature.text.split(/^### /m).slice(1);
  return sections.map((section) => {
    const [heading, ...body] = section.split("\n");
    const name = heading!.trim();
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const text = body.join("\n").trim();
    return {
      id,
      name,
      // Its first line (the cost) as the option's detail.
      description: text.replace(/\*/g, "").split("\n").find((line) => line.trim())?.trim(),
      grants: [{
        key: id,
        feature: {
          id, name: `${prefix}: ${name}`, category: "feature" as const, source: srd52Source(feature.key), description: text,
          automationSupport: "manual-only" as const
        }
      }]
    };
  });
}
