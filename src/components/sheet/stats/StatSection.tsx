"use client";

import { ChevronRight } from "lucide-react";
import { useId, type ReactNode } from "react";
import styles from "../sheet.module.css";

/**
 * One folding part of the Stats tab: its title and a one-line summary in statblock wording, opening to its fields (as
 * the ability editor's sections do).
 */
export function StatSection({ title, summary, open, onToggle, children }: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <section className={`${styles.statSection} ${open ? styles.statSectionOpen : ""}`} aria-label={title}>
      <button type="button" className={styles.statSectionHead} aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <ChevronRight className={styles.statChevron} size={14} aria-hidden="true" />
        <span className={styles.statSectionTitle}>{title}</span>
        <span className={styles.statSectionSummary}>{summary}</span>
      </button>
      {open ? <div id={bodyId} className={styles.statSectionBody}>{children}</div> : null}
    </section>
  );
}
