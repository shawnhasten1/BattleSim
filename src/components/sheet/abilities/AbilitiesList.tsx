"use client";

import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ListGroup, ListRow, MoveTarget } from "@/lib/ability-editor/list";
import styles from "./abilities.module.css";

const MOVE_LABELS: Record<MoveTarget, string> = { actions: "Move to actions", bonus: "Move to bonus actions", reactions: "Move to reactions" };

export interface RowHandlers {
  onOpen: (row: ListRow) => void;
  onDuplicate: (row: ListRow) => void;
  onMove: (row: ListRow, to: MoveTarget) => void;
  onDelete: (row: ListRow) => void;
  onToggleOptional: (row: ListRow, on: boolean) => void;
}

/**
 * The creature's abilities in statblock order (plan §3.1): Traits, Actions, Bonus actions, Reactions, Spellcasting,
 * Legendary actions, Lair actions, On death. A row opens its editor; its ⋯ menu duplicates, moves or deletes it.
 * `under` renders what belongs beneath a row (a builder form, a summon editor, a delete prompt).
 */
export function AbilitiesList({ groups, handlers, flashId, under }: {
  groups: ListGroup[];
  handlers: RowHandlers;
  /** The row an editor just saved, highlighted so the eye finds it. */
  flashId?: string;
  under?: (row: ListRow) => ReactNode;
}) {
  if (!groups.length) return <p className={styles.footnote} style={{ padding: "10px 12px" }}>No abilities yet: Add one above.</p>;
  return (
    <>
      {groups.map((group) => (
        <section key={group.id} className={styles.group} aria-label={group.title}>
          <h4 className={styles.groupHead}>
            {group.title}
            {group.note ? <span className={styles.groupNote}>{group.note}</span> : null}
          </h4>
          {group.rows.map((row) => <Row key={row.key} row={row} handlers={handlers} flash={flashId === rowId(row)} under={under} />)}
          {(group.levels ?? []).map((level) => (
            <div key={level.level}>
              <p className={styles.levelHead}>{level.title}{level.slots ? ` · ${level.slots}` : ""}</p>
              {level.rows.map((row) => <Row key={row.key} row={row} handlers={handlers} flash={flashId === rowId(row)} under={under} />)}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

/** The id the sheet uses for a row (its record's id; a legendary action's place). */
export function rowId(row: ListRow): string {
  return "id" in row.ref ? row.ref.id : `legendary-${row.ref.index}`;
}

function Row({ row, handlers, flash, under }: { row: ListRow; handlers: RowHandlers; flash: boolean; under?: (row: ListRow) => ReactNode }) {
  const opens = row.opens !== "none";
  return (
    <div data-row-id={rowId(row)}>
      <div className={`${styles.row} ${flash ? styles.rowFlash : ""}`}>
        <span className={styles.dot} data-automation={row.automation} role="img" aria-label={row.automationNote} title={row.automationNote} />
        <button
          type="button" className={styles.rowOpen} aria-label={`Edit ${row.name}`} disabled={!opens}
          title={opens ? undefined : "Legendary actions get their editor in a later update."}
          onClick={() => handlers.onOpen(row)}
        >
          <span className={styles.rowTitle}>
            <span className={styles.rowName}>{row.name}</span>
            {row.cost ? <span className={styles.cost}>{row.cost}</span> : null}
            {row.chips.map((chip) => <span key={chip} className={styles.chip}>{chip}</span>)}
          </span>
          {row.line ? <span className={styles.rowLine}>{row.line}</span> : null}
        </button>
        {row.enabled !== undefined ? (
          <label className={styles.optional} title="An optional rule: what it grants is only available while it's on">
            <input type="checkbox" checked={row.enabled} onChange={(event) => handlers.onToggleOptional(row, event.target.checked)} />
            Use it
          </label>
        ) : null}
        {row.itemType ? <RowMenu row={row} handlers={handlers} /> : null}
      </div>
      {under?.(row)}
    </div>
  );
}

/** ⋯: Duplicate, Move to…, Delete. Arrow keys move between items; Escape closes it. */
function RowMenu({ row, handlers }: { row: ListRow; handlers: RowHandlers }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector("button")?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !buttonRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }

  return (
    <span className={styles.menuWrap}>
      <button
        ref={buttonRef} type="button" className={styles.iconBtn} aria-label={`More for ${row.name}`} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={14} />
      </button>
      {open ? (
        <div ref={menuRef} className={styles.menu} role="menu" aria-label={`${row.name}`} onKeyDown={onKeyDown}>
          <button type="button" role="menuitem" onClick={() => choose(() => handlers.onDuplicate(row))}>Duplicate</button>
          {row.moves.map((to) => (
            <button key={to} type="button" role="menuitem" onClick={() => choose(() => handlers.onMove(row, to))}>{MOVE_LABELS[to]}</button>
          ))}
          <span className={styles.menuRule} aria-hidden />
          <button type="button" role="menuitem" className={styles.danger} onClick={() => choose(() => handlers.onDelete(row))}>Delete</button>
        </div>
      ) : null}
    </span>
  );
}
