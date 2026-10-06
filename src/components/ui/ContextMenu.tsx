"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOwnerDocument, useOwnerWindow } from "@/hooks/useOwnerDocument";
import styles from "./ContextMenu.module.css";

export type ContextMenuItem =
  | {
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      danger?: boolean;
      checked?: boolean;
      disabled?: boolean;
      /** A second line under the label: for a disabled item, why it's disabled. */
      hint?: string;
      /** Keep the menu open after choosing this item (e.g. a toggle you may flip repeatedly). */
      keepOpen?: boolean;
    }
  | { separator: true }
  | { heading: string }
  | {
      /**
       * A horizontal +/- row (e.g. current HP). Renders one button per `steps`
       * entry — negatives left of the value, positives right — and the buttons
       * never close the menu, so you can nudge repeatedly.
       */
      stepper: {
        label: string;
        value: number;
        /** Dim text after the value, e.g. `/ 30`. */
        sub?: string;
        /** Signed deltas, e.g. `[-5, -1, 1, 5]`. */
        steps: number[];
        onStep: (delta: number) => void;
        disabled?: boolean;
      };
    };

interface ContextMenuProps {
  /** Anchor point in viewport (client) coordinates — usually the cursor. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * A cursor-anchored popup menu. Portalled to the body of its document (a popped-out sheet's, or the main one) so no ancestor
 * `transform` / `overflow` can clip it; clamped into the viewport once its size
 * is known. Dismisses on outside pointerdown, Escape, scroll, or resize, and
 * after any item is chosen. Reusable — not wall-specific.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // In a popped-out sheet, the popup's document and window, not the main ones.
  const ownerDocument = useOwnerDocument();
  const ownerWindow = useOwnerWindow();
  const hintId = useId();
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      x: Math.max(pad, Math.min(x, ownerWindow.innerWidth - rect.width - pad)),
      y: Math.max(pad, Math.min(y, ownerWindow.innerHeight - rect.height - pad))
    });
  }, [x, y, items, ownerWindow]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    // Capture phase: close before other Escape handlers (e.g. the wall-chain one) act.
    ownerDocument.addEventListener("pointerdown", onPointerDown, true);
    ownerDocument.addEventListener("keydown", onKeyDown, true);
    ownerWindow.addEventListener("scroll", onClose, true);
    ownerWindow.addEventListener("resize", onClose);
    return () => {
      ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
      ownerDocument.removeEventListener("keydown", onKeyDown, true);
      ownerWindow.removeEventListener("scroll", onClose, true);
      ownerWindow.removeEventListener("resize", onClose);
    };
  }, [onClose, ownerDocument, ownerWindow]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if ("separator" in item) {
          return <div key={index} className={styles.separator} role="separator" />;
        }
        if ("heading" in item) {
          return (
            <div key={index} className={styles.heading} role="presentation">
              {item.heading}
            </div>
          );
        }
        if ("stepper" in item) {
          const step = item.stepper;
          const downs = step.steps.filter((n) => n < 0).sort((a, b) => a - b);
          const ups = step.steps.filter((n) => n > 0).sort((a, b) => a - b);
          return (
            <div key={index} className={styles.stepperRow} role="group" aria-label={step.label}>
              <div className={styles.stepperTop}>
                <span className={styles.stepperLabel}>{step.label}</span>
                <span className={styles.stepperValue}>
                  {step.value}
                  {step.sub ? <em>{step.sub}</em> : null}
                </span>
              </div>
              <div className={styles.stepperControls}>
                {[...downs, ...ups].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    className={styles.stepBtn}
                    disabled={step.disabled}
                    aria-label={`${step.label} ${delta > 0 ? `+${delta}` : delta}`}
                    onClick={() => step.onStep(delta)}
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </button>
                ))}
              </div>
            </div>
          );
        }
        return (
          <button
            key={index}
            type="button"
            role="menuitem"
            aria-checked={item.checked}
            // With a hint, the label alone names it, and the hint describes it.
            aria-label={item.hint ? item.label : undefined}
            aria-describedby={item.hint ? `${hintId}-${index}` : undefined}
            disabled={item.disabled}
            className={[styles.item, item.danger ? styles.danger : "", item.checked ? styles.checked : "", item.hint ? styles.withHint : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => {
              item.onSelect();
              if (!item.keepOpen) onClose();
            }}
          >
            <span className={styles.icon} aria-hidden="true">{item.icon}</span>
            <span className={styles.label}>
              {item.label}
              {item.hint ? <span id={`${hintId}-${index}`} className={styles.hint}>{item.hint}</span> : null}
            </span>
            <span className={styles.trailing} aria-hidden="true">{item.checked ? "✓" : ""}</span>
          </button>
        );
      })}
    </div>,
    ownerDocument.body
  );
}
