"use client";

import { Minus, X } from "lucide-react";
import { useEffect, useRef, type DragEvent, type ReactNode } from "react";
import { useFloatingWindow } from "@/hooks/useFloatingWindow";
import styles from "./FloatingWindow.module.css";

interface FloatingWindowProps {
  title: ReactNode;
  onClose: () => void;
  /** Accessible name when `title` is not a plain string. */
  ariaLabel?: string;
  /** Where the window first appears (px from the viewport top-left). */
  initialPosition?: { x: number; y: number };
  /** Override the default 340px window width (px). */
  width?: number;
  /** Persist the dragged position under this key (localStorage). */
  storageKey?: string;
  /** Start at `initialPosition` even when a position is remembered under `storageKey` (it's still remembered on drag). */
  restorePosition?: boolean;
  /** Told each new position. */
  onMove?: (position: { x: number; y: number }) => void;
  /** Stacking among the sheet windows: added to `--ui-z-sheet` (0-9; other windows sit at 10, above them). */
  zIndex?: number;
  /** A press or focus anywhere in the window: brings it to the front. */
  onFocus?: () => void;
  /** Rendered in the title bar between the title and the window controls. */
  headerExtra?: ReactNode;
  /** Rendered under the title bar, above the scrolling body, so it stays in view (the sheet's vitals and tabs). */
  subheader?: ReactNode;
  /** Optional drop-zone wiring for the whole window. */
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  dropActive?: boolean;
  children: ReactNode;
}

/**
 * A draggable, minimizable, non-modal window. Fixed width, scrolling body.
 * Not resizable yet — add when something needs it.
 *
 * Non-modal on purpose: Escape closes it and focus lands inside on open (and is
 * restored on close), but Tab is *not* trapped — you can move out to the canvas.
 */
export function FloatingWindow({
  title,
  onClose,
  ariaLabel,
  initialPosition = { x: 72, y: 60 },
  width,
  storageKey,
  restorePosition = true,
  onMove,
  zIndex,
  onFocus,
  headerExtra,
  subheader,
  onDragOver,
  onDragLeave,
  onDrop,
  dropActive,
  children
}: FloatingWindowProps) {
  const { position, minimized, toggleMinimize, titleBarProps } = useFloatingWindow(initialPosition, storageKey, { restore: restorePosition, onMove });
  const windowRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    windowRef.current?.focus({ preventScroll: true });
    return () => {
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div
      ref={windowRef}
      tabIndex={-1}
      className={[styles.window, dropActive ? styles.dropActive : ""].filter(Boolean).join(" ")}
      style={{ left: position.x, top: position.y, width, ...(zIndex !== undefined ? { zIndex: `calc(var(--ui-z-sheet) + ${zIndex})` } : {}) }}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
      role="dialog"
      aria-label={ariaLabel ?? (typeof title === "string" ? title : "Window")}
      // A React handler (not a native listener), so something inside that handles Escape itself — an open editor
      // asking about unsaved changes, a menu — can stop it from closing the window.
      onKeyDown={(event) => { if (event.key === "Escape") onCloseRef.current(); }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className={styles.titleBar} {...titleBarProps}>
        <span className={styles.title}>{title}</span>
        {headerExtra}
        <button type="button" className={styles.ctrl} onClick={toggleMinimize} aria-label={minimized ? "Expand" : "Minimize"}>
          <Minus size={13} />
        </button>
        <button type="button" className={styles.ctrl} onClick={onClose} aria-label="Close">
          <X size={13} />
        </button>
      </header>
      {subheader ? <div className={styles.subheader} hidden={minimized}>{subheader}</div> : null}
      {/* Hidden, not unmounted: minimizing mustn't throw away what's open inside (an ability being edited). */}
      <div className={styles.body} hidden={minimized}>{children}</div>
    </div>
  );
}
