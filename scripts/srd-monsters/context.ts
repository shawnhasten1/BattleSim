import type { Ability, CreatureDefinition } from "../../src/engine/types";
import { GapLog } from "./util";

/** One `actions[]` / `traits[]` entry as the Open5e v2 export writes it. */
export interface RawEntry {
  name: string;
  desc: string;
  action_type?: "ACTION" | "BONUS_ACTION" | "REACTION" | "LEGENDARY_ACTION";
  order_in_statblock?: number;
  legendary_action_cost?: number;
  limited_to_form?: string | null;
  usage_limits?: { type: "RECHARGE_ON_ROLL" | "PER_DAY"; param: number } | null;
}

/** Everything a sub-parser needs to know about the creature it is working on. */
export interface MonsterContext {
  slug: string;
  name: string;
  /** Lowercase name for matching text like "the dragon makes…". */
  lowerName: string;
  cr: number;
  proficiencyBonus: number;
  abilities: Record<Ability, number>;
  gaps: GapLog;
  /** Resource pools the creature needs (per-encounter uses, interim recharge). */
  resources: Record<string, number>;
  /** Used to keep generated action ids unique within the creature. */
  usedIds: Set<string>;
}

export function uniqueId(ctx: MonsterContext, base: string): string {
  let id = base || "action";
  let n = 2;
  while (ctx.usedIds.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  ctx.usedIds.add(id);
  return id;
}

export type MonsterDefinition = CreatureDefinition;
