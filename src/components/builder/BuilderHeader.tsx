"use client";

import { CodexBanner, LEVEL_VALUE_CLASS, LevelDial } from "@/components/codex-ui";
import { EditionFilter } from "@/components/ui/Edition";
import type { EditionChoice } from "@/lib/editions";
import type { SheetStyle } from "@/store/sheet-windows-store";
import styles from "./builder.module.css";

export interface HeaderPill {
  label: string;
  title: string;
  go: () => void;
}

/**
 * The builder's header (CHARACTER_BUILDER_UX_PLAN.md §1.1): the character's name, what it's made of (pills that go to
 * their steps), the edition filter, what's still open, and its level. In the Codex, the teal banner with the level dial;
 * in Standard, a plain header with the same controls.
 */
export function BuilderHeader({ look, name, onName, pills, filter, onFilter, open, onOpen, level, onLevel }: {
  look: SheetStyle;
  name: string;
  /** A new character's name is typed here; an existing one's is the sheet's. */
  onName?: (name: string) => void;
  pills: HeaderPill[];
  filter: EditionChoice;
  onFilter: (next: EditionChoice) => void;
  /** How many choices are still open. */
  open: number;
  onOpen: () => void;
  level: number;
  onLevel: (level: number) => void;
}) {
  const nameField = onName
    ? <input className={styles.headerName} aria-label="Name" placeholder="Name your hero" value={name} onChange={(event) => onName(event.target.value)} />
    : <span className={styles.headerName}>{name}</span>;
  const levels = Array.from({ length: 20 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>);
  const openButton = (
    <button type="button" className={styles.headerOpen} data-open={open > 0 || undefined} onClick={onOpen}>
      {open ? `${open} choice${open === 1 ? "" : "s"} left ›` : "All choices made ✓"}
    </button>
  );
  const pillButtons = (
    <div className={styles.headerPills}>
      {pills.map((pill) => <button key={pill.title} type="button" className={styles.headerPill} title={pill.title} onClick={pill.go}>{pill.label}</button>)}
    </div>
  );

  if (look === "codex") {
    return (
      <CodexBanner label="Name and level" className={styles.banner}>
        <div className={styles.headerTitle}>
          {nameField}
          {pillButtons}
        </div>
        <div className={styles.headerSide}>
          <EditionFilter value={filter} onChange={onFilter} label="Rules shown" />
          {openButton}
        </div>
        <LevelDial label="Level" title="Level">
          <select className={`${LEVEL_VALUE_CLASS} ${styles.dialSelect}`} aria-label="Level" value={level} onChange={(event) => onLevel(Number(event.target.value))}>
            {levels}
          </select>
        </LevelDial>
      </CodexBanner>
    );
  }
  return (
    <header className={styles.standardHeader} aria-label="Name and level">
      <div className={styles.headerTitle}>
        {nameField}
        {pillButtons}
      </div>
      <div className={styles.headerSide}>
        <EditionFilter value={filter} onChange={onFilter} label="Rules shown" />
        {openButton}
      </div>
      <label className={styles.field}>
        Level
        <select aria-label="Level" value={level} onChange={(event) => onLevel(Number(event.target.value))}>{levels}</select>
      </label>
    </header>
  );
}
