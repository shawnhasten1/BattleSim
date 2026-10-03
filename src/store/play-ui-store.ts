"use client";

import { create } from "zustand";
import type { Point } from "@/engine";

/**
 * What a person is in the middle of on their creature's turn in Play, and nothing that outlives it: the route they're
 * planning (stops on the way, the height to fly at), the square under the cursor, and where a dragged token would
 * land. Not persisted and not undoable. A plan belongs to the board it was made on (`planKey`: the creature and the
 * log's length), so one made before a move, an undo or a turn change is simply ignored.
 */
export interface PlayUiState {
  planKey: string | null;
  /** Stops on the way, in order (each the top-left square the creature would stand on). */
  waypoints: Point[];
  /** The height to fly at once the next move arrives; null keeps the height it has. */
  altitude: number | null;
  /** The square under the cursor. */
  hover: Point | null;
  /** Where the token being dragged would land (its top-left square), while it's dragged. */
  dragAnchor: Point | null;
  setHover: (cell: Point | null) => void;
  setDragAnchor: (cell: Point | null) => void;
  addWaypoint: (planKey: string, cell: Point) => void;
  /** Take back the last stop. False when there wasn't one. */
  popWaypoint: (planKey: string) => boolean;
  setAltitude: (planKey: string, altitude: number | null) => void;
  clearPlan: () => void;
}

/** The plan in force for `planKey`: the stored one if it was made on this board, else an empty one. */
export function planFor(state: Pick<PlayUiState, "planKey" | "waypoints" | "altitude">, planKey: string): { waypoints: Point[]; altitude: number | null } {
  return state.planKey === planKey ? { waypoints: state.waypoints, altitude: state.altitude } : { waypoints: [], altitude: null };
}

const samePoint = (a: Point | null, b: Point | null) => a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);

export const usePlayUiStore = create<PlayUiState>()((set, get) => ({
  planKey: null,
  waypoints: [],
  altitude: null,
  hover: null,
  dragAnchor: null,
  setHover: (cell) => {
    if (!samePoint(get().hover, cell)) set({ hover: cell });
  },
  setDragAnchor: (cell) => {
    if (!samePoint(get().dragAnchor, cell)) set({ dragAnchor: cell });
  },
  addWaypoint: (planKey, cell) => {
    const plan = planFor(get(), planKey);
    const last = plan.waypoints[plan.waypoints.length - 1] ?? null;
    if (samePoint(last, cell)) return;
    set({ planKey, waypoints: [...plan.waypoints, cell], altitude: plan.altitude });
  },
  popWaypoint: (planKey) => {
    const plan = planFor(get(), planKey);
    if (plan.waypoints.length === 0) return false;
    set({ planKey, waypoints: plan.waypoints.slice(0, -1), altitude: plan.altitude });
    return true;
  },
  setAltitude: (planKey, altitude) => {
    const plan = planFor(get(), planKey);
    set({ planKey, waypoints: plan.waypoints, altitude });
  },
  clearPlan: () => set({ planKey: null, waypoints: [], altitude: null, dragAnchor: null })
}));
