import type {
  Ability, ActionDefinition, AttackActionDefinition, CreatureDefinition, CreatureType, DamageAdjustment,
  FeatureDefinition, HealingActionDefinition, LegendaryActionRef, MovementProfile, RepositionActionDefinition, SizeCategory
} from "../../src/engine/types";
import type { GapCode, MonsterTier } from "../../src/data/srd/monsters/gaps";
import { parseAttack } from "./attacks";
import { type MonsterContext, type RawEntry, uniqueId } from "./context";
import { parseAbsorption, parseConditionImmunities, parseDamageAdjustments } from "./defenses";
import { parseMultiattack } from "./multiattack";
import { inferTactics } from "./tactics";
import { parseSwallow } from "./holds";
import { parseSaveAction, splitBoldVariants } from "./saves";
import { grantsMagicalWeapons, parseTrait } from "./traits";
import { applyUsage } from "./usage";
import { ABILITIES, GapLog, proficiencyForCr, slugify } from "./util";

const SIZES: SizeCategory[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const TYPES: CreatureType[] = [
  "aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey",
  "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"
];

export interface ParsedMonster {
  slug: string;
  definition: CreatureDefinition;
  gaps: GapCode[];
  gapNotes: Array<{ code: GapCode; note: string }>;
  tier: MonsterTier;
  meta: {
    xp: number;
    family?: string;
    spellcaster: boolean;
    legendary: boolean;
  };
}

function num(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function jsonArray<T>(value: string | undefined): T[] {
  if (!value || !value.trim()) return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

/** "history: 12, perception: 10" → { history: 12, perception: 10 }. */
function parseBonusList(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of text.split(",")) {
    const [name, value] = part.split(":").map((piece) => piece.trim());
    const parsed = value !== undefined ? Number(value) : NaN;
    if (name && Number.isFinite(parsed)) out[name.toLowerCase()] = parsed;
  }
  return out;
}

const FULL_SUPPORT_KINDS = new Set(["attack", "save", "area-save", "multiattack", "healing", "reposition"]);

/** Creature-level gap codes for the parts of the statblock that live outside actions and traits. */
function movementGaps(definition: CreatureDefinition, gaps: GapLog): void {
  const m = definition.movement;
  if (!m) return;
  // Swim, climb and burrow are real movement modes now (see `modeMultiplier` in geometry.ts). Flying is fast movement
  // that ignores the ground, but with no altitude a flier can still be reached by everything.
  if (m.fly) gaps.add("ALTITUDE", `fly ${m.fly} ft.${m.hover ? " (hover)" : ""}`);
}

function unsupportedAction(entry: RawEntry, ctx: MonsterContext, actionType: "action" | "reaction"): ActionDefinition {
  return {
    kind: "unsupported",
    id: uniqueId(ctx, slugify(entry.name)),
    name: entry.name,
    description: entry.desc,
    actionType,
    automationSupport: "unsupported"
  };
}

/** Names of special actions that belong to a later phase. */
function specialActionGap(name: string): GapCode {
  if (/^Change Shape/i.test(name)) return "TRANSFORM";
  if (/summon|animate|create specter|children of the night|split|call/i.test(name)) return "SPAWN";
  if (/^(swallow|engulf|reel|constrict)/i.test(name)) return "HOLD_SWALLOW";
  return "SPECIAL_ACTION";
}

/** Small self-contained special actions the engine already has a shape for. */
function parseSimpleSpecial(entry: RawEntry, ctx: MonsterContext): ActionDefinition | null {
  const text = entry.desc.replace(/\s+/g, " ");
  const teleport = /magically teleports(?: itself)?(?: up to)?\s+(\d+)\s*(?:ft\.?|feet)/i.exec(text);
  if (teleport && /^Teleport$/i.test(entry.name)) {
    const action: RepositionActionDefinition = {
      kind: "reposition",
      id: uniqueId(ctx, slugify(entry.name)),
      name: entry.name,
      actionType: /bonus action/i.test(text) ? "bonus" : "action",
      range: Number(teleport[1]),
      targeting: { target: "self" },
      automationSupport: "full"
    };
    return applyUsage(action, entry, ctx);
  }
  const heal = /(?:touches|touch).*?regains?\s+(\d+)\s*(?:\(([^)]+)\))?\s*hit points/i.exec(text);
  if (heal && /^Healing Touch/i.test(entry.name)) {
    const action: HealingActionDefinition = {
      kind: "healing",
      id: uniqueId(ctx, slugify(entry.name)),
      name: entry.name,
      actionType: "action",
      range: 5,
      healing: [{ dice: (heal[2] ?? heal[1]!).replace(/\s+/g, "") }],
      targeting: { target: "single" },
      automationSupport: "full"
    };
    return applyUsage(action, entry, ctx);
  }
  return null;
}

export function parseMonster(row: Record<string, string>): ParsedMonster {
  const slug = row.key!.replace(/^srd_/, "");
  const gaps = new GapLog();
  const cr = num(row.challenge_rating) ?? 0;
  const abilities = Object.fromEntries(
    ABILITIES.map((ability) => [ability, num(row[{ str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" }[ability]]) ?? 10])
  ) as Record<Ability, number>;

  const ctx: MonsterContext = {
    slug,
    name: row.name!,
    lowerName: row.name!.toLowerCase(),
    cr,
    proficiencyBonus: proficiencyForCr(cr),
    abilities,
    gaps,
    resources: {},
    usedIds: new Set()
  };

  const size = (row.size_key ?? "").toLowerCase() as SizeCategory;
  const type = (row.type_key ?? "").toLowerCase() as CreatureType;
  if (!SIZES.includes(size)) throw new Error(`${slug}: unknown size "${row.size_key}"`);
  if (!TYPES.includes(type)) throw new Error(`${slug}: unknown type "${row.type_key}"`);

  // ── Movement. A creature with no walk speed (a ghost) would be frozen if `speed` were 0.
  const speedJson = JSON.parse(row.speed_json || "{}") as Record<string, number | boolean | string>;
  const modes = {
    walk: Number(speedJson.walk ?? 0),
    fly: speedJson.fly ? Number(speedJson.fly) : undefined,
    swim: speedJson.swim ? Number(speedJson.swim) : undefined,
    climb: speedJson.climb ? Number(speedJson.climb) : undefined,
    burrow: speedJson.burrow ? Number(speedJson.burrow) : undefined,
    hover: speedJson.hover === true ? true : undefined
  };
  const movement: MovementProfile = {
    walk: modes.walk,
    ...(modes.fly ? { fly: modes.fly } : {}),
    ...(modes.swim ? { swim: modes.swim } : {}),
    ...(modes.climb ? { climb: modes.climb } : {}),
    ...(modes.burrow ? { burrow: modes.burrow } : {}),
    ...(modes.hover ? { hover: true } : {})
  };
  const groundSpeed = modes.walk > 0 ? modes.walk : Math.max(modes.fly ?? 0, modes.swim ?? 0, modes.climb ?? 0, modes.burrow ?? 0);

  // ── Traits first: they can change how actions are built (magical weapons).
  const rawTraits = jsonArray<RawEntry>(row.traits);
  const magicalWeapons = rawTraits.some(grantsMagicalWeapons);
  const traits: FeatureDefinition[] = rawTraits.map((entry) => parseTrait(entry, ctx));

  // ── Actions
  const rawActions = jsonArray<RawEntry>(row.actions).sort(
    (a, b) => (a.order_in_statblock ?? 0) - (b.order_in_statblock ?? 0) || a.name.localeCompare(b.name)
  );
  const actions: ActionDefinition[] = [];
  const reactions: ActionDefinition[] = [];
  const legendaryRaw: RawEntry[] = [];
  const multiattackRaw: RawEntry[] = [];
  const swallowRaw: RawEntry[] = [];
  const generatedFeatures: FeatureDefinition[] = [];

  for (const entry of rawActions) {
    if (entry.action_type === "LEGENDARY_ACTION") {
      legendaryRaw.push(entry);
      continue;
    }
    if (entry.action_type === "REACTION") {
      // "Parry. The knight adds 2 to its AC against one melee attack that would hit it": a Shield-style
      // reaction, taken when a melee attack targets it (the engine has no "would hit" window before the roll).
      const parryBonus = /^Parry$/i.test(entry.name) ? Number(/adds (\d+) to its AC/i.exec(entry.desc)?.[1]) : NaN;
      if (parryBonus > 0) {
        reactions.push({
          kind: "activate-feature", id: uniqueId(ctx, "parry"), name: "Parry", actionType: "reaction", featureId: "parry",
          reaction: { trigger: { kind: "targeted-by-attack", meleeOnly: true }, target: "self", priority: "always" },
          condition: { id: "parry-active", name: "custom", durationRounds: 1, modifiers: { armorClass: parryBonus } },
          automationSupport: "full"
        });
        continue;
      }
      gaps.add(/split/i.test(entry.name) ? "SPAWN" : "REACTION", entry.name);
      reactions.push(unsupportedAction(entry, ctx, "reaction"));
      continue;
    }
    if (/^Variant:/i.test(entry.name)) {
      // Optional rule: reference text, off by default (see the plan's variant policy).
      traits.push(parseTrait(entry, ctx));
      continue;
    }
    if (/^Multiattack$/i.test(entry.name)) {
      multiattackRaw.push(entry);
      continue;
    }
    if (/^Swallow$/i.test(entry.name) && /makes one bite attack against/i.test(entry.desc)) {
      swallowRaw.push(entry);
      continue;
    }

    const attack = parseAttack(entry, ctx);
    if (attack) {
      actions.push(...attack.actions);
      generatedFeatures.push(...attack.features);
      continue;
    }
    if (/^(Melee|Ranged)/.test(entry.desc)) {
      // parseAttack already recorded why it declined (a hold, or unreadable text).
      if (!gaps.gaps.some((gap) => gap.note.startsWith(entry.name))) gaps.add("ATTACK_UNPARSED", entry.name);
      actions.push(unsupportedAction(entry, ctx, "action"));
      continue;
    }

    const variants = splitBoldVariants(entry.desc);
    if (variants && /saving throw/i.test(entry.desc)) {
      const poolId = slugify(entry.name);
      let any = false;
      for (const variant of variants) {
        const parsed = parseSaveAction(entry, ctx, { name: variant.name, desc: variant.desc, poolId });
        if (parsed) {
          actions.push(parsed);
          any = true;
        }
      }
      if (!any) actions.push(unsupportedAction(entry, ctx, "action"));
      continue;
    }

    const save = parseSaveAction(entry, ctx);
    if (save) {
      actions.push(save);
      continue;
    }
    const simple = parseSimpleSpecial(entry, ctx);
    if (simple) {
      actions.push(simple);
      continue;
    }
    if (/saving throw/i.test(entry.desc)) {
      // parseSaveAction already recorded why it declined (hold, unmodeled effect…).
      if (!gaps.gaps.some((gap) => gap.note.startsWith(entry.name))) gaps.add("SAVE_UNPARSED", entry.name);
    } else {
      gaps.add(specialActionGap(entry.name), entry.name);
    }
    actions.push(unsupportedAction(entry, ctx, "action"));
  }

  // ── "Swallow. The behir makes one bite attack against a Medium or smaller target it is grappling. If the attack hits…"
  // A copy of its bite that can only target a creature it is grappling, with the swallow on top.
  for (const entry of swallowRaw) {
    const rider = parseSwallow(entry.desc, entry.desc);
    const bite = actions.find((action): action is AttackActionDefinition => action.kind === "attack" && /bite/i.test(action.name) && !/swallow/i.test(action.name));
    if (!rider || !bite) {
      gaps.add("HOLD_SWALLOW", entry.name);
      actions.push(unsupportedAction(entry, ctx, "action"));
      continue;
    }
    actions.push({
      ...bite,
      id: uniqueId(ctx, "swallow"),
      name: "Swallow",
      requiresHeld: true,
      riders: [...(bite.riders ?? []).filter((existing) => existing.kind !== "hold" && existing.kind !== "swallow"), { ...rider, requiresHeld: true }]
    });
  }

  // ── Multiattack needs the creature's own attacks to point at.
  const own = actions.filter((action): action is AttackActionDefinition => action.kind === "attack");
  const saveActions = actions.filter((action) => action.kind === "save" || action.kind === "area-save");
  const multiattacks = multiattackRaw.flatMap((entry) => parseMultiattack(entry, own, ctx, saveActions));
  actions.unshift(...multiattacks);

  // ── "Weapon attacks are magical"
  if (magicalWeapons) {
    for (const action of own) {
      if (action.attackType === "spell") continue;
      for (const component of action.damage) component.magical = true;
    }
  }

  // ── Legendary actions
  let legendary: CreatureDefinition["legendary"];
  if (legendaryRaw.length > 0) {
    const refs: LegendaryActionRef[] = legendaryRaw.map((entry) => {
      const ref: LegendaryActionRef = { name: entry.name, cost: entry.legendary_action_cost ?? 1, description: entry.desc };
      const text = entry.desc.toLowerCase();
      const stem = entry.name.replace(/ Attack$/i, "").toLowerCase();
      const runnable = own.filter((action) => action.kind === "attack" || action.kind === "save" || action.kind === "area-save");
      // "Tail Attack" → its Tail; "The lich uses its Paralyzing Touch", "makes one claw or tail attack" → the action the text names.
      const referenced = runnable.find((action) => action.name.toLowerCase() === stem)
        ?? runnable.find((action) => action.name.toLowerCase().startsWith(stem.split(" ")[0]!) && stem.length > 3)
        ?? runnable.find((action) => text.includes(action.name.toLowerCase()));
      if (referenced && !/saving throw/i.test(entry.desc)) {
        ref.actionId = referenced.id;
        return ref;
      }
      const inline = parseSaveAction({ ...entry, usage_limits: null }, { ...ctx, gaps: new GapLog() });
      if (inline) {
        inline.actionType = "action";
        ref.action = inline;
        return ref;
      }
      // "Detect" is a Perception check: nothing to simulate. Move / Teleport / Cast a Spell wait for later phases.
      if (!/^Detect$/i.test(entry.name)) gaps.add("LEGENDARY_ACTIONS", `${entry.name} (cost ${ref.cost})`);
      return ref;
    });
    legendary = { pool: 3, actions: refs };
    ctx.resources["legendary-points"] = 3;
  }

  const spellcaster = traits.some((trait) => /^(Innate )?Spellcasting/i.test(trait.name));

  // ── Defenses
  const adjustments: DamageAdjustment[] = [
    ...parseDamageAdjustments(row.damage_resistances_display ?? "", "resistance", gaps),
    ...parseDamageAdjustments(row.damage_immunities_display ?? "", "immunity", gaps),
    ...parseDamageAdjustments(row.damage_vulnerabilities_display ?? "", "vulnerability", gaps),
    ...rawTraits.flatMap((entry) => parseAbsorption(entry.name, entry.desc) ?? [])
  ];
  const conditionImmunities = parseConditionImmunities(row.condition_immunities_display ?? "", gaps);
  if (conditionImmunities.length > 0) {
    // Existing actors show these in the sheet as a manual-only trait ("Condition Immunity: Poisoned");
    // the `conditionImmunities` field is what the defenses phase will enforce.
    const names = conditionImmunities.map((name) => `${name[0]!.toUpperCase()}${name.slice(1)}`).join(", ");
    traits.push({
      id: `${slug}-trait-condition-immunities`,
      name: `Condition ${conditionImmunities.length === 1 ? "Immunity" : "Immunities"}: ${names}`,
      category: "trait",
      description: `Immune to: ${names.toLowerCase()}.`,
      automationSupport: "manual-only"
    });
  }

  const saves: Partial<Record<Ability, number>> = {};
  for (const ability of ABILITIES) {
    const key = { str: "save_strength", dex: "save_dexterity", con: "save_constitution", int: "save_intelligence", wis: "save_wisdom", cha: "save_charisma" }[ability];
    const value = num(row[key]);
    if (value !== undefined) saves[ability] = value;
  }

  const senses = {
    darkvision: num(row.darkvision_range),
    blindsight: num(row.blindsight_range),
    tremorsense: num(row.tremorsense_range),
    truesight: num(row.truesight_range)
  };
  const presentSenses = Object.fromEntries(Object.entries(senses).filter(([, value]) => value !== undefined && value > 0));

  const definition: CreatureDefinition = {
    id: `srd:monster:${slug}`,
    name: row.name!,
    source: {
      provider: "srd",
      documentKey: row.document_key || "srd-2014",
      documentName: row.document_name || "System Reference Document 5.1",
      slug,
      url: row.document_permalink || undefined
    },
    size,
    type,
    armorClass: num(row.armor_class) ?? 10,
    maxHp: Math.max(1, num(row.hit_points) ?? 1),
    speed: groundSpeed,
    movement,
    proficiencyBonus: ctx.proficiencyBonus,
    challengeRating: cr,
    alignment: row.alignment || undefined,
    environments: (row.environments ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    ...(Object.keys(presentSenses).length ? { senses: presentSenses } : {}),
    skills: parseBonusList(row.skill_bonuses ?? ""),
    languages: row.languages || undefined,
    abilities,
    ...(Object.keys(saves).length ? { saves } : {}),
    ...(adjustments.length ? { damageAdjustments: adjustments } : {}),
    ...(conditionImmunities.length ? { conditionImmunities } : {}),
    ...(Object.keys(ctx.resources).length ? { resources: { ...ctx.resources } } : {}),
    traits: [...traits, ...generatedFeatures],
    actions,
    ...(reactions.length ? { reactions } : {}),
    ...(legendary ? { legendary } : {})
  };
  movementGaps(definition, gaps);
  const tactics = inferTactics(definition, slug);
  definition.defaultTactics = tactics.profile;
  if (tactics.resourceStance !== "balanced") definition.defaultResourceStance = tactics.resourceStance;

  const compiled = actions.filter((action) => FULL_SUPPORT_KINDS.has(action.kind)).length;
  const codes = gaps.codes();
  // A creature with nothing tagged is fully modelled even if it has no attacks (a sea horse). "manual"
  // means there are gaps AND none of its actions run.
  const tier: MonsterTier = codes.length === 0
    ? "full"
    : compiled === 0 && rawActions.some((entry) => entry.action_type !== "LEGENDARY_ACTION") ? "manual" : "partial";

  return {
    slug,
    definition,
    gaps: codes,
    gapNotes: gaps.gaps,
    tier,
    meta: {
      xp: num(row.experience_points) ?? 0,
      family: row.subcategory || undefined,
      spellcaster,
      legendary: legendary !== undefined
    }
  };
}
