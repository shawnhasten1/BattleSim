"use client";

import type { ReactNode } from "react";
import styles from "./ChipRow.module.css";

/** Wrapping container for a set of filter Chips (e.g. Compendium categories). */
export function ChipRow({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

interface ChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
}

/** A single pill-shaped filter toggle. */
export function Chip({ label, active, onClick }: ChipProps) {
  return (
    <button
      type="button"
      className={[styles.chip, active ? styles.active : ""].filter(Boolean).join(" ")}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
