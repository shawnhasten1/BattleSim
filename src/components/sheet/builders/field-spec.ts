/**
 * The data-driven form model behind every guided builder. A builder is a flat
 * `BuilderDraft` record plus a `FieldSpec[]` that says which controls to render,
 * in what order, and — crucially — *when* (`visibleWhen`). Nothing about layout
 * is hard-coded per builder: adding a capability is adding a `FieldSpec`.
 */

export type BuilderDraft = Record<string, unknown>;

export type FieldControl =
  | "text"
  | "number"
  | "toggle"
  | "select"
  | "ability"
  | "damage-type"
  | "dice"
  | "riders"
  | "properties"
  | "reaction-trigger"
  | "feature-effects"
  | "granted-actions";

export interface FieldSpec {
  /** Flat key into the draft. */
  key: string;
  /** Key into `FIELD_COPY` for the visible label + hint. */
  copy: string;
  control: FieldControl;
  /** Options for `select`. */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** Hidden in Simple mode unless the draft holds a non-default value for this key. */
  advanced?: boolean;
  /** Progressive-disclosure predicate — evaluated against the live draft. */
  visibleWhen?: (draft: BuilderDraft) => boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  /** Context passed to the `riders` control (default rider gate + whether the source has an action-level save). */
  riderContext?: "weapon" | "save" | "area";
}

/**
 * A draft key counts as "set" (worth surfacing in Simple mode) only when it
 * holds a non-empty, non-default-ish value. `0` / `""` / `false` / `[]` /
 * nullish all read as unset — so a draft that pre-fills every advanced field
 * with its default still shows a clean Simple form. Deviations from a default
 * (a `true` toggle, a non-zero number, a chosen string) do surface.
 */
export function hasMeaningfulValue(value: unknown): boolean {
  if (value == null || value === "" || value === false || value === 0) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Resolve which specs render for a draft + mode. In Simple mode an
 * `advanced` spec still shows (marked) when it holds a non-default value, so
 * nothing is ever silently hidden.
 */
export function visibleSpecs(specs: FieldSpec[], draft: BuilderDraft, mode: "simple" | "advanced"): Array<FieldSpec & { markedAdvanced: boolean }> {
  return specs
    .filter((spec) => !spec.visibleWhen || spec.visibleWhen(draft))
    .map((spec) => {
      const isSet = hasMeaningfulValue(draft[spec.key]);
      return { ...spec, markedAdvanced: Boolean(spec.advanced) && mode === "simple" && isSet };
    })
    .filter((spec) => !(spec.advanced && mode === "simple" && !hasMeaningfulValue(draft[spec.key])));
}
