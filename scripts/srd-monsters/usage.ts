import type { ActionUsage } from "../../src/engine/types";
import type { MonsterContext, RawEntry } from "./context";

/**
 * Records a recharge / per-day limit on an action. Both compile to a pool `usage:<poolId|actionId>` the
 * action spends from (`usagePoolId` in the engine): X/day is X uses in a single-encounter sim, and a
 * recharge ability starts full and is rolled back at the start of the creature's turns.
 */
export function applyUsage<T extends { id: string; usage?: ActionUsage; resourceCost?: { resourceId: string; amount: number } }>(
  action: T,
  raw: Pick<RawEntry, "usage_limits" | "name">,
  ctx: MonsterContext,
  poolId?: string
): T {
  const limit = raw.usage_limits;
  if (!limit) return action;
  const pool = poolId ?? action.id;
  const resourceId = `usage:${pool}`;
  if (limit.type === "RECHARGE_ON_ROLL") {
    action.usage = { kind: "recharge", recharge: { min: limit.param }, ...(poolId ? { poolId } : {}) };
    ctx.resources[resourceId] = 1;
  } else {
    action.usage = { kind: "uses", uses: limit.param, ...(poolId ? { poolId } : {}) };
    ctx.resources[resourceId] = Math.max(ctx.resources[resourceId] ?? 0, limit.param);
  }
  action.resourceCost = { resourceId, amount: 1 };
  return action;
}
