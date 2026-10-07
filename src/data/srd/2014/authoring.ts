import type { ActionDefinition, FeatureDefinition, FeatureEffect } from "@/engine";
import type { ChoiceSpec, FeatureGrant, PickOption } from "@/lib/character-builder/catalog";
import { srd51Source } from "../source";
import { PREFIX_2014, srd14Feat, srd14Feature, srd14FeatureText, srd14TraitText } from "./reference";

/**
 * Small helpers for writing the 2014 catalog, as `../2024/authoring.ts` does for 2024: a feature's name and description
 * come from the SRD 5.1 reference, so the catalog only says what runs. Ids here are placeholders: the builder gives each
 * feature on an actor an id of its own.
 */

const refKey = (key: string) => (key.startsWith(PREFIX_2014) ? key : `${PREFIX_2014}${key}`);

interface FeatureOptions {
  name?: string;
  effects?: FeatureEffect[];
  grantedActions?: ActionDefinition[];
  aura?: FeatureDefinition["aura"];
  /** What the simulator doesn't run of it, appended to the SRD text. */
  notSimulated?: string;
  automationSupport?: FeatureDefinition["automationSupport"];
}

/** Where a feature's name and text come from: a class or subclass feature, the feat, a race trait, or text of its own. */
type Origin = string | { feat: string } | { race: string; trait: string } | { name: string; text: string; slug: string };

function origin(from: Origin): { id: string; name: string; text: string; slug: string } {
  if (typeof from === "string") {
    const feature = srd14Feature(from);
    return { id: feature.key.slice(PREFIX_2014.length), name: feature.name, text: srd14FeatureText(from), slug: feature.key };
  }
  if ("feat" in from) {
    const feat = srd14Feat(from.feat);
    return { id: feat.key.slice(PREFIX_2014.length), name: feat.name, text: [feat.text, ...feat.benefits.map((benefit) => `- ${benefit}`)].join("\n"), slug: feat.key };
  }
  if ("race" in from) {
    // The audit's key for a race trait: `srd_dwarf:Dwarven Resilience`.
    const slug = `${refKey(from.race)}:${from.trait}`;
    return { id: from.trait.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: from.trait, text: srd14TraitText(from.race, from.trait), slug };
  }
  return { id: from.slug, name: from.name, text: from.text, slug: from.slug };
}

function base(from: Origin, options: FeatureOptions): FeatureDefinition {
  const { id, name, text, slug } = origin(from);
  return {
    id,
    name: options.name ?? name,
    category: typeof from === "object" && "race" in from ? "trait" : "feature",
    source: srd51Source(slug),
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

/** A grant of a feature, tied to the SRD feature it covers (its `ref`, for the audit). */
export function grant(key: string, feature: FeatureDefinition, extra: Omit<FeatureGrant, "key" | "feature" | "ref"> = {}): FeatureGrant {
  const slug = feature.source?.slug ?? "";
  return { key, ...(slug.startsWith(PREFIX_2014) && !slug.includes(":") ? { ref: slug } : {}), feature, ...extra };
}

/** A grant the builder does without a feature of its own (a class's Spellcasting): it covers its SRD feature, for the audit. */
export function builderGrant(key: string, ref: string, extra: Omit<FeatureGrant, "key" | "feature" | "ref"> = {}): FeatureGrant {
  return { key, ref: refKey(ref), ...extra };
}

/** A choice tied to the SRD feature it covers ("Ability Score Improvement", "Martial Archetype"). */
export function choice<C extends ChoiceSpec>(spec: C, ref: string): C & { ref: string } {
  return { ...spec, ref: refKey(ref) };
}

/** 20 values from a sparse "from level N, value V" list: `fromLevels([[2, 1], [17, 2]])` → null, 1 … 1, 2, 2, 2, 2. */
export function fromLevels(steps: Array<[number, number]>): Array<number | null> {
  return Array.from({ length: 20 }, (_, index) => {
    let value: number | null = null;
    for (const [level, amount] of steps) if (index + 1 >= level) value = amount;
    return value;
  });
}

/**
 * The options a feature's text lists ("### Careful Spell" …), each as a `pick` option putting its text on the actor as a
 * feature named `<prefix>: <option>`: `effects` by option id say what runs; the rest stay the SRD's text (manual).
 * `partial` names the options that run only in part, with what doesn't.
 */
export function referenceOptions(key: string, prefix: string, effects: Record<string, FeatureEffect[]> = {}, partial: Record<string, string> = {}): PickOption[] {
  const feature = srd14Feature(key);
  return srd14FeatureText(key).split(/^### /m).slice(1).map((section) => {
    const [heading, ...body] = section.split("\n");
    const name = heading!.trim();
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const text = body.join("\n").trim();
    const runs = effects[id];
    return {
      id,
      name,
      description: text.split("\n").find((line) => line.trim())?.trim(),
      grants: [{
        key: id,
        feature: {
          id, name: `${prefix}: ${name}`, category: "feature" as const, source: srd51Source(`${feature.key}:${name}`),
          description: partial[id] ? `${text}\n\nNot simulated: ${partial[id]}` : text,
          automationSupport: runs ? (partial[id] ? "partial" as const : "full" as const) : "manual-only" as const,
          ...(runs ? { effects: runs } : {})
        }
      }]
    };
  });
}

/** A 2014 library spell's id: `spell("fireball")` → `srd:spell:fireball`. */
export const spell = (slug: string) => `srd:spell:${slug}`;
