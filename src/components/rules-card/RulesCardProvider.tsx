"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import type { RulesEntry } from "@/lib/character-builder/describe";
import type { CodexPaletteId } from "@/lib/actor-sheet/codex";
import { codexPortalProps } from "@/components/codex-ui";
import { useOwnerDocument, useOwnerWindow } from "@/hooks/useOwnerDocument";
import { RulesCard } from "./RulesCard";
import styles from "./rules-card.module.css";

/** An entry, or what works one out when its card is shown (so hovering a long list works out only what it shows). */
export type EntrySource = RulesEntry | (() => RulesEntry | undefined) | undefined;

/** What an element spreads to show a card: hover, focus, tap, and `i` to pin it. */
export interface BoundProps {
  onMouseEnter: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export interface RulesCardApi {
  bind: (entry: EntrySource) => BoundProps;
  /** Opens the full card for an entry: the provider's `onPin` (a pane), or a pinned card where the anchor is. */
  pin: (entry: RulesEntry, anchor?: HTMLElement | null) => void;
  /** Closes whatever card is showing. */
  close: () => void;
}

const NOOP: BoundProps = {
  onMouseEnter: () => {}, onMouseLeave: () => {}, onFocus: () => {}, onBlur: () => {},
  onPointerDown: () => {}, onClickCapture: () => {}, onKeyDown: () => {}
};
const FALLBACK: RulesCardApi = { bind: () => NOOP, pin: () => {}, close: () => {} };
const RulesCardContext = createContext<RulesCardApi | null>(null);

/** The nearest provider's cards; outside one, nothing happens (so a component works anywhere). */
export function useRulesCard(): RulesCardApi {
  return useContext(RulesCardContext) ?? FALLBACK;
}

const SHOW_DELAY = 300;
const HIDE_DELAY = 150;
const resolve = (entry: EntrySource) => (typeof entry === "function" ? entry() : entry);

interface Shown {
  entry: RulesEntry;
  anchor: HTMLElement;
  pinned: boolean;
}

/**
 * Rules cards for everything inside (CHARACTER_BUILDER_UX_PLAN.md D3): one card at a time, on hover after a short pause
 * (at once while another is open, so a grid can be scanned), on keyboard focus, and on a first tap. It stays while the
 * pointer is on it, so long text can be scrolled; Esc closes it; "Read all" or `i` pins its full text. With a `palette`
 * it wears the Codex's colours (it's portalled out of the Codex's root, so it carries them).
 */
export function RulesCardProvider({ palette, onPin, children }: {
  palette?: CodexPaletteId | null;
  /** Where a pinned card goes instead of floating: a step's detail pane. */
  onPin?: (entry: RulesEntry) => void;
  children: ReactNode;
}) {
  const ownerDocument = useOwnerDocument();
  const ownerWindow = useOwnerWindow();
  const cardId = useId();
  const [shown, setShown] = useState<Shown | null>(null);
  const shownRef = useRef<Shown | null>(null);
  shownRef.current = shown;
  const showTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const swallowClick = useRef<HTMLElement | null>(null);
  const onPinRef = useRef(onPin);
  onPinRef.current = onPin;
  const cardRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const clearTimers = () => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
  };

  const show = useCallback((entry: RulesEntry, anchor: HTMLElement, pinned = false) => {
    clearTimers();
    setPosition(null);
    setShown({ entry, anchor, pinned });
  }, []);

  const hideSoon = useCallback(() => {
    window.clearTimeout(showTimer.current);
    if (shownRef.current?.pinned) return;
    hideTimer.current = window.setTimeout(() => setShown((current) => (current?.pinned ? current : null)), HIDE_DELAY);
  }, []);

  const pin = useCallback((entry: RulesEntry, anchor?: HTMLElement | null) => {
    clearTimers();
    if (onPinRef.current) {
      setShown(null);
      onPinRef.current(entry);
      return;
    }
    const at = anchor ?? shownRef.current?.anchor;
    if (at) show(entry, at, true);
  }, [show]);

  const close = useCallback(() => {
    clearTimers();
    setShown(null);
  }, []);

  const api = useMemo<RulesCardApi>(() => ({
    pin,
    close,
    bind: (source) => {
      if (!source) return NOOP;
      const open = (anchor: HTMLElement, immediate: boolean) => {
        window.clearTimeout(hideTimer.current);
        window.clearTimeout(showTimer.current);
        if (shownRef.current?.pinned) return;
        const go = () => {
          const entry = resolve(source);
          if (entry) show(entry, anchor);
        };
        if (immediate || shownRef.current) go();
        else showTimer.current = window.setTimeout(go, SHOW_DELAY);
      };
      return {
        onMouseEnter: (event) => open(event.currentTarget, false),
        onMouseLeave: hideSoon,
        onFocus: (event) => open(event.currentTarget, true),
        onBlur: hideSoon,
        onPointerDown: (event) => {
          if (event.pointerType !== "touch") return;
          // A first tap shows the card; a second (or the card's own button) chooses.
          if (shownRef.current?.anchor !== event.currentTarget) {
            swallowClick.current = event.currentTarget;
            open(event.currentTarget, true);
          }
        },
        onClickCapture: (event) => {
          if (swallowClick.current !== event.currentTarget) return;
          swallowClick.current = null;
          event.preventDefault();
          event.stopPropagation();
        },
        onKeyDown: (event) => {
          if (event.key !== "i" || event.altKey || event.ctrlKey || event.metaKey) return;
          const target = event.target as HTMLElement;
          if (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "checkbox" && (target as HTMLInputElement).type !== "radio") return;
          const entry = resolve(source);
          if (!entry) return;
          event.preventDefault();
          pin(entry, event.currentTarget);
        }
      };
    }
  }), [close, hideSoon, pin, show]);

  // The anchor names the card while it shows (and only then).
  useEffect(() => {
    const anchor = shown?.anchor;
    if (!anchor) return;
    anchor.setAttribute("aria-describedby", cardId);
    return () => anchor.removeAttribute("aria-describedby");
  }, [shown?.anchor, cardId]);

  // Beside its anchor: to the right if there's room, else to the left, else below; always on screen.
  useLayoutEffect(() => {
    if (!shown || !cardRef.current) return;
    const anchor = shown.anchor.getBoundingClientRect();
    const card = cardRef.current.getBoundingClientRect();
    const pad = 8;
    const width = ownerWindow.innerWidth;
    const height = ownerWindow.innerHeight;
    let left = anchor.right + 10;
    let top = anchor.top - 4;
    if (left + card.width > width - pad) left = anchor.left - card.width - 10;
    if (left < pad) {
      left = Math.min(Math.max(pad, anchor.left), width - card.width - pad);
      top = anchor.bottom + 6;
      if (top + card.height > height - pad) top = anchor.top - card.height - 6;
    }
    top = Math.max(pad, Math.min(top, height - card.height - pad));
    setPosition({ left, top });
  }, [shown, ownerWindow]);

  // Esc closes it; a click outside closes a pinned one; scrolling away or a resize closes a hover one.
  useEffect(() => {
    if (!shown) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setShown(null);
      event.stopPropagation();
    }
    function onPointerDown(event: globalThis.PointerEvent) {
      const target = event.target as Node;
      if (cardRef.current?.contains(target) || shownRef.current?.anchor.contains(target)) return;
      if (shownRef.current?.pinned) setShown(null);
    }
    function onScroll(event: Event) {
      if (shownRef.current?.pinned) return;
      if (cardRef.current?.contains(event.target as Node)) return;
      setShown(null);
    }
    ownerDocument.addEventListener("keydown", onKeyDown, true);
    ownerDocument.addEventListener("pointerdown", onPointerDown, true);
    ownerWindow.addEventListener("scroll", onScroll, true);
    ownerWindow.addEventListener("resize", close);
    return () => {
      ownerDocument.removeEventListener("keydown", onKeyDown, true);
      ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
      ownerWindow.removeEventListener("scroll", onScroll, true);
      ownerWindow.removeEventListener("resize", close);
    };
  }, [shown, ownerDocument, ownerWindow, close]);

  useEffect(() => () => clearTimers(), []);

  const themed = palette ? codexPortalProps(palette) : undefined;
  return (
    <RulesCardContext.Provider value={api}>
      {children}
      {shown && ownerDocument
        ? createPortal(
          <RulesCard
            ref={cardRef}
            id={cardId}
            entry={shown.entry}
            variant={shown.pinned ? "full" : "hover"}
            onPin={() => pin(shown.entry, shown.anchor)}
            onClose={shown.pinned ? close : undefined}
            onMouseEnter={() => window.clearTimeout(hideTimer.current)}
            onMouseLeave={hideSoon}
            className={themed?.className}
            data-dark={themed?.["data-dark"]}
            style={{ ...themed?.style, ...(position ? { left: position.left, top: position.top } : { left: -9999, top: 0, visibility: "hidden" }) }}
          />,
          ownerDocument.body
        )
        : null}
    </RulesCardContext.Provider>
  );
}

/**
 * A field (its `<label>` and select) with an ⓘ at its label row's end: the card of what it has chosen. The ⓘ is outside
 * the label, so the label names only its select.
 */
export function FieldInfo({ entry, about, children }: { entry: EntrySource; about?: string; children: ReactNode }) {
  return (
    <div className={styles.fieldInfo}>
      {children}
      {entry && about ? <RulesInfo entry={entry} label={`About ${about}`} className={styles.fieldInfoButton} /> : null}
    </div>
  );
}

/** An ⓘ beside something that has no hover of its own (a select): its card on hover, focus or a click. */
export function RulesInfo({ entry, label, className }: { entry: EntrySource; label: string; className?: string }) {
  const cards = useRulesCard();
  const bound = cards.bind(entry);
  return (
    <button
      type="button" className={className ? `${styles.info} ${className}` : styles.info} aria-label={label} {...bound}
      onClick={(event) => {
        const resolved = resolve(entry);
        if (resolved) cards.pin(resolved, event.currentTarget);
      }}
    >
      i
    </button>
  );
}
