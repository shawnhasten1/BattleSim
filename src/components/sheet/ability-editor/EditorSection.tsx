"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./ability-editor.module.css";

/**
 * One section of the editor: a header that shows its one-line summary and opens or closes it, and its fields.
 * `flagged` marks a section that a warning points at.
 */
export function EditorSection({ id, title, summary, open, onToggle, flagged, children }: {
  id: string;
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  flagged?: boolean;
  children: ReactNode;
}) {
  const bodyId = `ability-section-${id}`;
  return (
    <section className={`${styles.section} ${open ? styles.sectionOpen : ""}`} data-section={id}>
      <button type="button" className={styles.sectionHead} aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <ChevronRight className={styles.chevron} size={14} aria-hidden />
        <span className={styles.sectionTitle}>{title}</span>
        <span className={styles.sectionSummary}>{summary}</span>
        {flagged ? <span className={styles.sectionFlag} role="img" aria-label="has a warning" /> : <span />}
      </button>
      {open ? <div id={bodyId} className={styles.sectionBody}>{children}</div> : null}
    </section>
  );
}
