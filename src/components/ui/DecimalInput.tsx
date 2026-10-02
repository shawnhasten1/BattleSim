"use client";

import { useState, type InputHTMLAttributes } from "react";

interface DecimalInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "step" | "min" | "max"> {
  value: number;
  /** Called with each typed value that's a number within range. */
  onCommit: (value: number) => void;
  /** Arrow keys step by this (Shift: ten times as much). */
  step?: number;
  min?: number;
  max?: number;
  /** How the value shows while the box isn't being typed in. */
  format?: (value: number) => string;
}

/**
 * A box for a decimal, like the ability editor's NumberField: what's typed stays while it has
 * focus ("-", "3."), only numbers in range are committed, and the arrow keys step it. It's a
 * text box, so the mouse wheel never changes it by accident.
 */
export function DecimalInput({ value, onCommit, step = 1, min, max, format = String, onFocus, onBlur, onKeyDown, ...rest }: DecimalInputProps) {
  const [typed, setTyped] = useState<string | null>(null);
  const inRange = (n: number) => Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max);
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={typed ?? format(value)}
      onFocus={(event) => {
        setTyped(format(value));
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setTyped(null);
        onBlur?.(event);
      }}
      onChange={(event) => {
        const text = event.target.value;
        setTyped(text);
        const n = Number(text.trim());
        if (text.trim() !== "" && inRange(n)) onCommit(n);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const delta = (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1);
        const next = Math.round((value + delta) * 1000) / 1000;
        if (!inRange(next)) return;
        onCommit(next);
        setTyped(format(next));
      }}
    />
  );
}
