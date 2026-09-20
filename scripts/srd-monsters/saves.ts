import type {
  ActionDefinition, ActionRider, AreaSaveActionDefinition, AreaTemplate, SaveActionDefinition
} from "../../src/engine/types";
import { type MonsterContext, type RawEntry, uniqueId } from "./context";
import { buildConditionRider, findConditionOnFail, findSaveClause, findSaveDamage } from "./riders";
import { applyUsage } from "./usage";
import { describesMagicalEffect, slugify } from "./util";

const FT = "(?:ft\\.?|feet|foot)";

interface AreaMatch {
  area: AreaTemplate;
  origin: "self";
  aimedFromSelf: boolean;
  range: number;
}

/** "60-foot cone", "60-foot line that is 5 feet wide", "20-foot-radius sphere", "within 10 ft. of the dragon". */
function findArea(text: string): AreaMatch | null {
  const cone = new RegExp(`(\\d+)[- ]${FT}[- ]cone`, "i").exec(text);
  if (cone) {
    const size = Number(cone[1]);
    return { area: { type: "cone", size }, origin: "self", aimedFromSelf: true, range: size };
  }
  const line = new RegExp(`(\\d+)[- ]${FT}[- ]line(?: that is (\\d+) ${FT} wide)?`, "i").exec(text);
  if (line) {
    const size = Number(line[1]);
    return { area: { type: "line", size, width: line[2] ? Number(line[2]) : 5 }, origin: "self", aimedFromSelf: true, range: size };
  }
  const cube = new RegExp(`(\\d+)[- ]${FT}[- ]cube`, "i").exec(text);
  if (cube) {
    const size = Number(cube[1]);
    return { area: { type: "square", size }, origin: "self", aimedFromSelf: false, range: size };
  }
  const radius = new RegExp(`(\\d+)[- ]${FT}[- ]radius|within (\\d+) ${FT} of (?:the|it|itself|him|her|this)`, "i").exec(text);
  if (radius && /each creature|every creature/i.test(text)) {
    const size = Number(radius[1] ?? radius[2]);
    return { area: { type: "circle", size }, origin: "self", aimedFromSelf: false, range: size };
  }
  return null;
}

/** Effects that a save action can carry that we don't model — reported instead of silently dropped. */
const UNMODELED = /hit point maximum|regains?\b|swallow|engulf|grappl|escape DC|attaches|teleport|pulled|paralyzed while poisoned/i;

export interface SaveParseOptions {
  /** Overrides the entry's name/description (a breath-weapon variant split out of a parent entry). */
  name?: string;
  desc?: string;
  poolId?: string;
}

/** Parses an action built around "DC N <Ability> saving throw" into a `save` or `area-save`. */
export function parseSaveAction(entry: RawEntry, ctx: MonsterContext, options: SaveParseOptions = {}): ActionDefinition | null {
  const name = options.name ?? entry.name;
  const text = (options.desc ?? entry.desc).replace(/\s+/g, " ").trim();
  const save = findSaveClause(text);
  if (!save) return null;

  if (/swallow|engulf/i.test(text)) {
    ctx.gaps.add("HOLD_SWALLOW", name);
    return null;
  }
  if (/grappled|escape DC/i.test(text)) {
    ctx.gaps.add("HOLD_GRAPPLE", name);
    return null;
  }
  if (UNMODELED.test(text)) {
    ctx.gaps.add("SAVE_UNPARSED", `${name}: ${(UNMODELED.exec(text) ?? [""])[0]}`);
    return null;
  }

  const damage = findSaveDamage(text);
  const condition = findConditionOnFail(text);
  const pushed = /pushed (?:up to )?(\d+) (?:ft\.?|feet)/i.exec(text);
  if (!damage && !condition && !pushed) {
    ctx.gaps.add("SAVE_UNPARSED", `${name}: no damage or condition found`);
    return null;
  }

  const riders: ActionRider[] = [];
  if (condition) riders.push(buildConditionRider(condition, "on-save-fail"));
  if (pushed && !damage) riders.push({ kind: "push", when: "on-save-fail", distance: Number(pushed[1]) });
  if (/is immune to .* for the next 24 hours/i.test(text)) {
    ctx.gaps.add("SAVE_IMMUNITY_AFTER", name);
  }

  const onSuccess: "half" | "negates" = damage?.half ? "half" : "negates";
  const affects: "hostile" | "all" = /of the [\w ]+'s choice|aware of it/i.test(text) ? "hostile" : "all";
  const id = uniqueId(ctx, slugify(name));
  const common = {
    id,
    name,
    actionType: "action" as const,
    saveAbility: save.ability,
    dc: save.dc,
    damage: damage?.damage ?? [],
    halfDamageOnSuccess: onSuccess === "half",
    onSuccess,
    ...(riders.length > 0 ? { riders } : {}),
    ...(describesMagicalEffect(text) ? { magical: true } : {}),
    automationSupport: "full" as const
  };

  const area = findArea(text);
  if (area) {
    const action: AreaSaveActionDefinition = {
      ...common,
      kind: "area-save",
      range: area.range,
      area: area.area,
      targeting: { origin: "self", aimedFromSelf: area.aimedFromSelf, range: area.range },
      affects
    };
    return applyUsage(action, entry, ctx, options.poolId);
  }

  const rangeMatch = new RegExp(`within (\\d+) ${FT}`, "i").exec(text);
  const single: SaveActionDefinition = {
    ...common,
    kind: "save",
    range: rangeMatch ? Number(rangeMatch[1]) : 5
  };
  return applyUsage(single, entry, ctx, options.poolId);
}

/**
 * "Breath Weapons" style entries bundle several actions as bold bullets
 * ("- **Fire Breath.** …"). Returns the pieces, or null for an ordinary entry.
 */
export function splitBoldVariants(desc: string): Array<{ name: string; desc: string }> | null {
  const matches = [...desc.matchAll(/(?:^|\n)\s*-?\s*\*\*([^*]+?)\.\*\*\s*([\s\S]*?)(?=\n\s*-?\s*\*\*[^*]+?\.\*\*|$)/g)];
  if (matches.length < 2) return null;
  return matches.map((match) => ({ name: match[1]!.trim(), desc: match[2]!.trim() }));
}
