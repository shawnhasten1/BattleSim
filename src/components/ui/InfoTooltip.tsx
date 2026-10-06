"use client";

import { HelpCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOwnerDocument, useOwnerWindow } from "@/hooks/useOwnerDocument";
import styles from "./InfoTooltip.module.css";

interface InfoTooltipProps {
  /** Accessible name for the trigger, e.g. "About tactics profiles". */
  label: string;
  content: ReactNode;
  /** A trigger of the caller's own (a condition chip's name) in place of the "?" icon, styled by `className`. */
  children?: ReactNode;
  className?: string;
}

/**
 * A small "?" icon that reveals an explanatory bubble on hover/focus (and on
 * tap, for touch devices). Portalled to its document's body (a popped-out sheet's, or the main one) and position-clamped
 * like `ContextMenu`, so it's safe to drop into any panel regardless of that
 * panel's `overflow`/scroll — e.g. the sheet's `FloatingWindow` clips content
 * past its edges. Content is caller-supplied, so this is the one reusable
 * primitive for "hover to explain" anywhere in the UI.
 */
export function InfoTooltip({ label, content, children, className }: InfoTooltipProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ownerDocument = useOwnerDocument();
  const ownerWindow = useOwnerWindow();

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const anchor = trigger.getBoundingClientRect();
    const size = bubble.getBoundingClientRect();
    const pad = 8;
    const x = Math.max(pad, Math.min(anchor.left, ownerWindow.innerWidth - size.width - pad));
    // Prefer below the trigger; flip above if there's no room.
    const below = anchor.bottom + 6;
    const y = below + size.height > ownerWindow.innerHeight - pad ? anchor.top - size.height - 6 : below;
    setPos({ x, y: Math.max(pad, y) });
  }, [open, ownerWindow]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (triggerRef.current?.contains(event.target as Node)) return;
      if (bubbleRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Opened from the keyboard, Escape only closes the bubble; it isn't also a "close" for the window or editor
      // around it. (Opened by hovering, it closes the bubble and carries on as usual.)
      if (triggerRef.current === ownerDocument.activeElement) event.stopPropagation();
    }
    function onDismiss() {
      setOpen(false);
    }
    ownerDocument.addEventListener("pointerdown", onPointerDown, true);
    ownerDocument.addEventListener("keydown", onKeyDown, true);
    ownerWindow.addEventListener("scroll", onDismiss, true);
    ownerWindow.addEventListener("resize", onDismiss);
    return () => {
      ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
      ownerDocument.removeEventListener("keydown", onKeyDown, true);
      ownerWindow.removeEventListener("scroll", onDismiss, true);
      ownerWindow.removeEventListener("resize", onDismiss);
    };
  }, [open, ownerDocument, ownerWindow]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className ?? styles.trigger}
        aria-label={label}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
      >
        {children ?? <HelpCircle size={13} />}
      </button>
      {open
        ? createPortal(
          <div ref={bubbleRef} role="tooltip" className={styles.bubble} style={{ left: pos.x, top: pos.y }}>
            {content}
          </div>,
          ownerDocument.body
        )
        : null}
    </>
  );
}
