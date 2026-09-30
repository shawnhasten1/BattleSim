"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { COPY, type CopyKey } from "./copy";
import styles from "./ability-editor.module.css";

/** A label (with its hint behind a "?"), above one control. Pass `id` to tie the label to the control. */
export function Field({ copy, id, children, extra }: { copy: CopyKey; id?: string; children: ReactNode; extra?: ReactNode }) {
  const entry = COPY[copy] as { label: string; hint?: string };
  return (
    <div className={styles.field}>
      <span className={styles.label}>
        {id ? <label htmlFor={id}>{entry.label}</label> : <span>{entry.label}</span>}
        {entry.hint ? <InfoTooltip label={`About ${entry.label.toLowerCase()}`} content={<p>{entry.hint}</p>} /> : null}
        {extra}
      </span>
      {children}
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Shown on hover. */
  title?: string;
}

/**
 * A single choice from a few options, as a row of buttons (a radio group: arrow keys move the choice). `label` names
 * the group for screen readers.
 */
export function Segmented<T extends string>({
  label, value, options, onChange
}: { label: string; value: T | undefined; options: Array<SegmentOption<T>>; onChange: (next: T) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = options.findIndex((option) => option.value === value);
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, at: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (at + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  }
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((option, at) => (
        <button
          key={option.value}
          ref={(node) => { refs.current[at] = node; }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          // One stop in the tab order: the chosen option, or the first when none is chosen.
          tabIndex={option.value === value || (index < 0 && at === 0) ? 0 : -1}
          title={option.title}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, at)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A number box that can be cleared while typing: the value only changes once the text is a number in range, and the
 * box shows the value again when it loses focus. `onChange(undefined)` when it's emptied and `optional` is set.
 */
export function NumberField({
  id, value, onChange, min, max, step = 1, optional, wide, label, placeholder, signed
}: {
  id?: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  optional?: boolean;
  wide?: boolean;
  /** Accessible name when no `Field` label points at it. */
  label?: string;
  placeholder?: string;
  /** Shows "+3" for positive numbers (a to-hit bonus). */
  signed?: boolean;
}) {
  const show = (n: number | undefined) => (n === undefined ? "" : signed && n > 0 ? `+${n}` : String(n));
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  function change(raw: string) {
    setText(raw);
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (optional) onChange(undefined);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return;
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) return;
    onChange(n);
  }
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      className={wide ? styles.numWide : styles.num}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setText(show(value)); }}
      onChange={(event) => change(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const next = (value ?? min ?? 0) + (event.key === "ArrowUp" ? step : -step);
        if ((min !== undefined && next < min) || (max !== undefined && next > max)) return;
        onChange(next);
        setText(show(next));
      }}
    />
  );
}

/** A checkbox with its label (and hint) beside it. */
export function Check({ copy, checked, onChange, label, disabled, title }: {
  copy?: CopyKey;
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  /** Why it's disabled, on hover. */
  title?: string;
}) {
  const entry = copy ? (COPY[copy] as { label: string; hint?: string }) : { label: label ?? "" };
  return (
    <span className={styles.inline}>
      <label className={styles.check} title={title}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        {label ?? entry.label}
      </label>
      {entry.hint ? <InfoTooltip label={`About ${(label ?? entry.label).toLowerCase()}`} content={<p>{entry.hint}</p>} /> : null}
    </span>
  );
}

/** "More options": rarer settings, folded away. `set` counts the ones that aren't at their default, so they're never hidden unseen. */
export function More({ set, children, label = "More options", defaultOpen }: { set: number; children: ReactNode; label?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const bodyId = useId();
  return (
    <div className={styles.more}>
      <button type="button" className={styles.moreToggle} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
        <ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 0.12s ease" }} />
        {label}
        {set > 0 && !open ? <span className={styles.moreSet}>{set} set</span> : null}
      </button>
      {open ? <div id={bodyId} className={styles.moreBody}>{children}</div> : null}
    </div>
  );
}
