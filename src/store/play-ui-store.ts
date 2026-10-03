"use client";

import { create } from "zustand";
import type { Id, Point } from "@/engine";
import type { Aim, HotbarTab } from "@/lib/play/hotbar";

/**
 * What a person is in the middle of on their creature's turn in Play, and nothing that outlives it: the route they're
 * planning (stops on the way, the height to fly at), the ability they've armed and the creatures picked for it, the
 * hotbar's tab, the square under the cursor, and where a dragged token would land. Not persisted and not undoable. A
 * plan or an armed ability belongs to the board it was made on (`planKey`: the creature and the log's length), so one
 * made before a move, an undo or a turn change is simply ignored. The aim of a multiattack's next swing belongs to its
 * question (`requestKey`).
 */
export interface ArmedAbility {
  planKey: string;
  /** The hotbar button's family, and the variant armed. */
  key: string;
  actionId: Id;
  aim: Aim;
  /** Creatures picked so far, in order (one may repeat for rays and beams). */
  picked: Id[];
}

export interface SwingAim {
  /** The question it answers. */
  requestKey: string;
  /** The attack chosen for this swing. */
  actionId?: Id;
  /** A square to move to before swinging. */
  moveTo?: Point;
}

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
  tab: HotbarTab;
  armed: ArmedAbility | null;
  swing: SwingAim | null;
  /** Why the last click while aiming did nothing (that creature is out of range…), until the next one. */
  note: string | null;
  setHover: (cell: Point | null) => void;
  setDragAnchor: (cell: Point | null) => void;
  addWaypoint: (planKey: string, cell: Point) => void;
  /** Take back the last stop. False when there wasn't one. */
  popWaypoint: (planKey: string) => boolean;
  setAltitude: (planKey: string, altitude: number | null) => void;
  clearPlan: () => void;
  setTab: (tab: HotbarTab) => void;
  arm: (armed: Omit<ArmedAbility, "picked">) => void;
  disarm: () => void;
  /** Add a creature to the armed ability's picks (or, without repeats, take it off again). */
  pick: (id: Id) => void;
  /** Take back the last pick. False when there wasn't one. */
  unpick: () => boolean;
  setSwing: (swing: SwingAim | null) => void;
  setNote: (note: string | null) => void;
}

/** The plan in force for `planKey`: the stored one if it was made on this board, else an empty one. */
export function planFor(state: Pick<PlayUiState, "planKey" | "waypoints" | "altitude">, planKey: string): { waypoints: Point[]; altitude: number | null } {
  return state.planKey === planKey ? { waypoints: state.waypoints, altitude: state.altitude } : { waypoints: [], altitude: null };
}

/** The ability armed on this board, if one is. */
export function armedFor(state: Pick<PlayUiState, "armed">, planKey: string): ArmedAbility | null {
  return state.armed?.planKey === planKey ? state.armed : null;
}

/** The aim of a swing for this question, if one has been started. */
export function swingFor(state: Pick<PlayUiState, "swing">, requestKey: string): SwingAim | null {
  return state.swing?.requestKey === requestKey ? state.swing : null;
}

const samePoint = (a: Point | null, b: Point | null) => a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);

export const usePlayUiStore = create<PlayUiState>()((set, get) => ({
  planKey: null,
  waypoints: [],
  altitude: null,
  hover: null,
  dragAnchor: null,
  tab: "attacks",
  armed: null,
  swing: null,
  note: null,
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
  clearPlan: () => set({ planKey: null, waypoints: [], altitude: null, dragAnchor: null }),
  setTab: (tab) => set({ tab }),
  arm: (armed) => set({ armed: { ...armed, picked: [] }, note: null }),
  disarm: () => set({ armed: null, note: null }),
  pick: (id) => {
    const armed = get().armed;
    if (!armed || armed.aim.kind !== "creatures") return;
    const { count, repeat } = armed.aim;
    if (!repeat && armed.picked.includes(id)) {
      set({ armed: { ...armed, picked: armed.picked.filter((picked) => picked !== id) } });
      return;
    }
    if (armed.picked.length >= count) return;
    set({ armed: { ...armed, picked: [...armed.picked, id] } });
  },
  unpick: () => {
    const armed = get().armed;
    if (!armed || armed.picked.length === 0) return false;
    set({ armed: { ...armed, picked: armed.picked.slice(0, -1) } });
    return true;
  },
  setSwing: (swing) => set({ swing, note: null }),
  setNote: (note) => set({ note })
}));
