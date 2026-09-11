"use client";

import { HelpCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./InfoTooltip.module.css";

interface InfoTooltipProps {
  /** Accessible name for the trigger, e.g. "About tactics profiles". */
  label: string;
  content: ReactNode;
}

/**
 * A small "?" icon that reveals an explanatory bubble on hover/focus (and on
 * tap, for touch devices). Portalled to `document.body` and position-clamped
 * like `ContextMenu`, so it's safe to drop into any panel regardless of that
 * panel's `overflow`/scroll — e.g. the sheet's `FloatingWindow` clips content
 * past its edges. Content is caller-supplied, so this is the one reusable
 * primitive for "hover to explain" anywhere in the UI.
 */
export function InfoTooltip({ label, content }: InfoTooltipProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const anchor = trigger.getBoundingClientRect();
    const size = bubble.getBoundingClientRect();
    const pad = 8;
    const x = Math.max(pad, Math.min(anchor.left, window.innerWidth - size.width - pad));
    // Prefer below the trigger; flip above if there's no room.
    const below = anchor.bottom + 6;
    const y = below + size.height > window.innerHeight - pad ? anchor.top - size.height - 6 : below;
    setPos({ x, y: Math.max(pad, y) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (triggerRef.current?.contains(event.target as Node)) return;
      if (bubbleRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onDismiss() {
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onDismiss);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={label}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
      >
        <HelpCircle size={13} />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
          <div ref={bubbleRef} role="tooltip" className={styles.bubble} style={{ left: pos.x, top: pos.y }}>
            {content}
          </div>,
          document.body
        )
        : null}
    </>
  );
}
