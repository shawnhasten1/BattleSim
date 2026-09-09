"use client";

import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import styles from "./Row.module.css";

interface RowProps {
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  title?: string;
  className?: string;
}

/**
 * The list-row layout primitive used by the Actors, Compendium, and Combat
 * panels. Pure layout: children (a Thumb, a label block, an HpBar, edit/add
 * buttons) are composed by the caller.
 */
export function Row({ children, onClick, selected, draggable, onDragStart, title, className }: RowProps) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!onClick) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  }

  return (
    <div
      className={[styles.row, onClick ? styles.clickable : "", selected ? styles.selected : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      onKeyDown={onKeyDown}
      draggable={draggable}
      onDragStart={onDragStart}
      title={title}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
}
