"use client";

import type { ReactNode } from "react";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import styles from "../sheet.module.css";

/**
 * A row of a Token section, in a `.rows` grid: its name (labelling `htmlFor`, when it's one control, and with its "?"
 * help after it, outside the label) beside its controls.
 */
export function Row({ label, htmlFor, help, children }: { label: string; htmlFor?: string; help?: ReactNode; children: ReactNode }) {
  return (
    <>
      <span className={styles.rowLabel}>
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
        {help ? <InfoTooltip label={`About ${label.toLowerCase()}`} content={help} /> : null}
      </span>
      <div className={styles.rowBody}>{children}</div>
    </>
  );
}
