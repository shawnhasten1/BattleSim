/**
 * Saving a builder edit without losing what the builder can't show.
 *
 * Each builder edits a flat `BuilderDraft`, and its converter (`weaponFromDraft`,
 * `actionFromEffectDraft`, …) rebuilds a record from that draft. The rebuild is a
 * projection: fields the draft has no place for come back missing, or reset to the
 * converter's defaults. So a save never writes the rebuilt record. It rebuilds twice —
 * from the draft as it was when the builder opened, and from the draft now — and writes
 * only the difference onto the stored record. Whatever the DM didn't change can't change.
 */
import type { BuilderDraft } from "./field-spec";

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality in which a key holding `undefined` counts as absent, as it does once saved. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

/** Keys the converters mint afresh on every rebuild; they never say which stored element a rebuilt one came from. */
const MINTED_KEYS = new Set(["id", "featureId"]);

/**
 * Whether `rebuilt` could be the converter's rendering of `stored`: every value it sets matches, ignoring minted ids.
 * Guards the element-by-element list merge, so a converter that reorders a list can't apply one element's edit to another.
 */
function isRenderingOf(rebuilt: unknown, stored: unknown): boolean {
  if (rebuilt === undefined) return true;
  if (Array.isArray(rebuilt)) {
    return Array.isArray(stored) && stored.length === rebuilt.length && rebuilt.every((item, index) => isRenderingOf(item, stored[index]));
  }
  if (isPlainObject(rebuilt)) {
    return isPlainObject(stored) && Object.entries(rebuilt).every(([key, value]) => MINTED_KEYS.has(key) || isRenderingOf(value, stored[key]));
  }
  return rebuilt === stored;
}

/**
 * Apply the change between `before` and `after` — one converter run on the opening draft and on the current one — to
 * `stored`:
 * - Objects merge key by key: only keys whose rebuilt value changed are written, recursively.
 * - A changed `kind` (attack → save) is a different ability, so the rebuilt value wins. At the top level it is spread
 *   over the stored record, as saves always were, keeping the stored id and anything the new kind doesn't set.
 * - Lists merge element by element when the rebuild lines up with what's stored: the same length, and either a single
 *   element or each rebuilt element a rendering of the stored one. Otherwise the rebuilt list replaces the stored one.
 * A key the change removes comes back as `undefined` rather than deleted, so a shallow `{ ...stored, ...result }` clears it.
 */
export function applyDraftDelta(stored: unknown, before: unknown, after: unknown, topLevel = true): unknown {
  if (deepEqual(before, after)) return stored;
  if (isPlainObject(before) && isPlainObject(after) && isPlainObject(stored)) {
    if (before.kind !== after.kind) {
      if (!topLevel) return after;
      const minted = Object.fromEntries([...MINTED_KEYS].filter((key) => stored[key] !== undefined).map((key) => [key, stored[key]]));
      return { ...stored, ...after, ...minted };
    }
    const result: PlainObject = { ...stored };
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!deepEqual(before[key], after[key])) {
        result[key] = applyDraftDelta(stored[key], before[key], after[key], false);
      }
    }
    return result;
  }
  if (
    Array.isArray(before) && Array.isArray(after) && Array.isArray(stored)
    && before.length === after.length && before.length === stored.length
    // A single element can't have been reordered, so it lines up even when the converter renders it differently.
    && (before.length === 1 || before.every((item, index) => isRenderingOf(item, stored[index])))
  ) {
    return after.map((item, index) => applyDraftDelta(stored[index], before[index], item, false));
  }
  return after;
}

export interface DraftEditResult<T> {
  /** False when nothing the converter reads changed: skip the write, and with it the undo step. */
  changed: boolean;
  /** The stored record with the DM's changes applied — the whole record, ready to hand to a store `update…` action. */
  record: T;
}

/** Work out what saving `currentDraft` should write over `stored`, given the draft the builder opened with. */
export function mergeDraftEdit<T>(
  stored: T,
  initialDraft: BuilderDraft,
  currentDraft: BuilderDraft,
  convert: (draft: BuilderDraft) => unknown
): DraftEditResult<T> {
  const before = convert(initialDraft);
  const after = convert(currentDraft);
  if (deepEqual(before, after)) return { changed: false, record: stored };
  return { changed: true, record: applyDraftDelta(stored, before, after) as T };
}
