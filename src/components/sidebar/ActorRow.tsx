"use client";

import { MoreHorizontal, Plus } from "lucide-react";
import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import styles from "./ActorsPanel.module.css";

/**
 * One actor in the Actors tab's directory (ACTORS_TAB_PLAN.md, Phase 3), yours or an SRD monster alike. A click selects
 * it; a double-click or Enter opens its sheet. Dragging it onto the map places a token, as does +; ⋯ and a right-click
 * open its menu.
 */
export function ActorRow({ name, subtitle, thumbnail, selected, title, addTitle, onSelect, onOpen, onAdd, onMenu, onDragStart }: {
  name: string;
  subtitle: ReactNode;
  thumbnail: ReactNode;
  selected: boolean;
  /** On hover: more about it (an SRD monster's automation gaps). */
  title?: string;
  /** What + does: "Add to the map as an enemy". */
  addTitle: string;
  onSelect: () => void;
  onOpen: () => void;
  onAdd: () => void;
  /** Its menu, at the pointer or under ⋯. */
  onMenu: (at: { x: number; y: number }) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onOpen();
  }

  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
    onSelect();
    onMenu({ x: event.clientX, y: event.clientY });
  }

  return (
    <li
      className={`${styles.actorRow} ${selected ? styles.actorRowSelected : ""}`}
      draggable
      onDragStart={onDragStart}
      onContextMenu={onContextMenu}
    >
      {thumbnail}
      <button
        type="button" className={styles.cardMain} aria-pressed={selected}
        title={title ? `${title}\n\nDouble-click to open its sheet.` : "Double-click to open its sheet."}
        onClick={onSelect} onDoubleClick={onOpen} onKeyDown={onKeyDown}
      >
        <strong>{name}</strong>
        <span>{subtitle}</span>
      </button>
      <button type="button" className={styles.rowAction} onClick={onAdd} title={addTitle} aria-label={`${addTitle}: ${name}`}>
        <Plus size={14} />
      </button>
      <button
        type="button" className={styles.rowAction} aria-label={`More for ${name}`} aria-haspopup="menu"
        onClick={(event) => {
          onSelect();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu({ x: rect.left, y: rect.bottom + 4 });
        }}
      >
        <MoreHorizontal size={14} />
      </button>
    </li>
  );
}
