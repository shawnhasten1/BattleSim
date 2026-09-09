"use client";

import styles from "./AutomationBadge.module.css";

/**
 * Small badge showing how much of an action/spell/feature the engine automates.
 * Mirrors the `automationSupport` union on engine definitions; ported from the
 * legacy inline badge in app/page.tsx.
 */
export type AutomationSupport = "full" | "partial" | "manual-only" | "unsupported";

const TONE: Record<string, string> = {
  full: styles.full,
  partial: styles.partial,
  unsupported: styles.unsupported
};

function toneClass(value: string): string {
  return TONE[value] ?? styles.manual;
}

function label(value: string): string {
  return value === "manual-only" ? "reference-only" : value;
}

export function AutomationBadge({ value }: { value: AutomationSupport | string }) {
  return <span className={`${styles.badge} ${toneClass(value)}`}>{label(value)}</span>;
}
