import type { ActionUsage } from "../../src/engine/types";
import type { MonsterContext, RawEntry } from "./context";

/**
 * Records a recharge / per-day limit on an action.
 *
 * The engine can't roll recharges yet, so as an interim safeguard the action also
 * gets a one-use-per-encounter resource pool (X/day = X uses). That is right for
 * X/day in a single-encounter sim and a deliberate under-approximation for
 * recharge — better than a breath weapon fired every round. The limited-use phase
 * drops the interim `resourceCost` + pool and enforces `usage` natively.
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
    ctx.gaps.add("RECHARGE", `${raw.name} (Recharge ${limit.param}-6)`);
  } else {
    action.usage = { kind: "uses", uses: limit.param, ...(poolId ? { poolId } : {}) };
    ctx.resources[resourceId] = Math.max(ctx.resources[resourceId] ?? 0, limit.param);
    ctx.gaps.add("LIMITED_USE", `${raw.name} (${limit.param}/Day)`);
  }
  action.resourceCost = { resourceId, amount: 1 };
  return action;
}
