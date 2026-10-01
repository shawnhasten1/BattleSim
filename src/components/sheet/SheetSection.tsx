"use client";

import { ChevronRight } from "lucide-react";
import { useId, type ReactNode } from "react";
import styles from "./sheet.module.css";

/**
 * One folding part of the Stats or Token tab: its title and a one-line summary (in statblock wording, on Stats),
 * opening to its fields, as the ability editor's sections do.
 */
export function SheetSection({ title, summary, open, onToggle, children }: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <section className={`${styles.sheetSection} ${open ? styles.sheetSectionOpen : ""}`} aria-label={title}>
      <button type="button" className={styles.sheetSectionHead} aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <ChevronRight className={styles.sheetChevron} size={14} aria-hidden="true" />
        <span className={styles.sheetSectionTitle}>{title}</span>
        <span className={styles.sheetSectionSummary}>{summary}</span>
      </button>
      {open ? <div id={bodyId} className={styles.sheetSectionBody}>{children}</div> : null}
    </section>
  );
}
