"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * The sheet's boxes commit as you type (plan D3). Everything committed while one box has focus is one undo step: the
 * step its first change made. The next focus starts a new one.
 */
function useEditSession() {
  const id = useId();
  const mergeEdits = useEncounterStore((s) => s.mergeEdits);
  const count = useRef(0);
  const key = useRef<string | null>(null);
  return useMemo(() => {
    const begin = () => { key.current = `${id}:${(count.current += 1)}`; };
    return {
      begin,
      end: () => { key.current = null; },
      run: (edit: () => void) => {
        // A change with no focus first (a color picker reopened) starts a step of its own.
        if (key.current === null) begin();
        mergeEdits(key.current!, edit);
      }
    };
  }, [id, mergeEdits]);
}

interface SheetNumberCommon {
  value: number | undefined;
  min?: number;
  max?: number;
  /** What the arrow keys add. A whole-number step also means only whole numbers are taken. */
  step?: number;
  /** Accessible name, when no `<label>` wraps the box. */
  label?: string;
  /** For a `<label htmlFor>` beside the box. */
  id?: string;
  placeholder?: string;
  /** Shows a bonus with its sign: "+6". */
  signed?: boolean;
  /** For a box outside a tab's own styles (the resource list). */
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  /** On hover: why it's disabled. */
  title?: string;
}

type SheetNumberProps = SheetNumberCommon & (
  | { optional?: false; onCommit: (next: number) => void }
  /** Emptying the box commits `undefined` (a save going back to its modifier). */
  | { optional: true; onCommit: (next: number | undefined) => void }
);

const show = (n: number | undefined, signed?: boolean) => (n === undefined ? "" : signed && n > 0 ? `+${n}` : String(n));

/**
 * A number box on the sheet. A value is committed as it's typed, once it's a number in range. Anything else (an empty
 * box, a lone "-", a number out of range) commits nothing, and the box shows the stored value again when it loses
 * focus. Out of range is marked while you type.
 */
export function SheetNumber(props: SheetNumberProps) {
  const { value, min, max, step = 1, label, id, placeholder, signed, className, style, disabled, title } = props;
  const session = useEditSession();
  const [text, setText] = useState(show(value, signed));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(value, signed));
  }, [value, signed]);

  const whole = Number.isInteger(step);
  const decimals = whole ? 0 : (String(step).split(".")[1] ?? "").length;

  /** The value `raw` commits: a number, `undefined` (an emptied optional box), or `null` for nothing. */
  function parse(raw: string): number | undefined | null {
    const trimmed = raw.trim();
    if (trimmed === "") return props.optional ? undefined : null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || (whole && !Number.isInteger(n))) return null;
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) return null;
    return n;
  }

  function commit(next: number | undefined) {
    if (next === value) return;
    session.run(() => (props.onCommit as (next: number | undefined) => void)(next));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const from = parse(text) ?? value ?? 0;
    let next = Number((from + (event.key === "ArrowUp" ? step : -step)).toFixed(decimals));
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    setText(show(next, signed));
    commit(next);
  }

  const invalid = text.trim() !== "" && parse(text) === null;
  return (
    <input
      type="text"
      inputMode={whole ? "numeric" : "decimal"}
      id={id}
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      value={text}
      className={className}
      style={style}
      disabled={disabled}
      title={title}
      onFocus={() => { focused.current = true; session.begin(); }}
      onBlur={() => { focused.current = false; session.end(); setText(show(value, signed)); }}
      onChange={(event) => {
        setText(event.target.value);
        const next = parse(event.target.value);
        if (next !== null) commit(next);
      }}
      onKeyDown={onKeyDown}
    />
  );
}

/** A text box on the sheet: committed as it's typed, one undo step per edit. */
export function SheetText({ value, onCommit, label, placeholder, style, autoSelect }: {
  value: string;
  onCommit: (next: string) => void;
  label?: string;
  placeholder?: string;
  style?: CSSProperties;
  /** Focus the box with its text selected, ready to type over, when this turns true (a creature just made). */
  autoSelect?: boolean;
}) {
  const session = useEditSession();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoSelect) return;
    ref.current?.focus();
    ref.current?.select();
  }, [autoSelect]);
  return (
    <input
      ref={ref}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      style={style}
      onFocus={session.begin}
      onBlur={session.end}
      onChange={(event) => {
        const next = event.target.value;
        if (next !== value) session.run(() => onCommit(next));
      }}
    />
  );
}

/**
 * A color swatch on the sheet. The map follows the picker as you drag in it, and the whole pick is one undo step: React
 * reports every `input` as a change, and the native `change` event (the picker closing) ends the step.
 */
export function SheetColor({ value, onCommit, label }: { value: string; onCommit: (next: string) => void; label?: string }) {
  const session = useEditSession();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.addEventListener("change", session.end);
    return () => node.removeEventListener("change", session.end);
  }, [session]);
  return (
    <input
      ref={ref}
      type="color"
      aria-label={label}
      value={value}
      onFocus={session.begin}
      onBlur={session.end}
      onChange={(event) => {
        const next = event.target.value;
        if (next !== value) session.run(() => onCommit(next));
      }}
    />
  );
}
