"use client";

import { PanelTopClose, Redo2, Undo2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { OwnerDocumentContext } from "@/hooks/useOwnerDocument";
import styles from "./PopoutWindow.module.css";

export interface PopupBounds {
  width: number;
  height: number;
  left?: number;
  top?: number;
}

const STYLESHEETS = 'link[rel="stylesheet"], style';

/** A copy of a main-window stylesheet node, marked so the mirror can find (and drop) it again. */
function copyStylesheet(node: Element, target: Document, index: Map<Node, Element>) {
  const copy = target.importNode(node, true) as Element;
  copy.setAttribute("data-popout-copy", "");
  index.set(node, copy);
  target.head.appendChild(copy);
}

/**
 * Open a named popup and write a bare page into it: the main page's stylesheets and its `<html>` classes (which carry
 * the `next/font` variables). Call it from a click handler, so popup blockers allow it. Null when the browser blocked it.
 */
export function openPopup(name: string, bounds: PopupBounds, title: string): Window | null {
  const features = [
    "popup",
    `width=${Math.round(bounds.width)}`,
    `height=${Math.round(bounds.height)}`,
    ...(bounds.left !== undefined ? [`left=${Math.round(bounds.left)}`] : []),
    ...(bounds.top !== undefined ? [`top=${Math.round(bounds.top)}`] : [])
  ].join(",");
  const popup = window.open("", name, features);
  if (!popup) return null;
  const doc = popup.document;
  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>');
  doc.close();
  doc.documentElement.lang = document.documentElement.lang;
  doc.documentElement.className = document.documentElement.className;
  doc.title = title;
  const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (icon) doc.head.appendChild(doc.importNode(icon, true));
  const index = new Map<Node, Element>();
  document.head.querySelectorAll(STYLESHEETS).forEach((node) => copyStylesheet(node, doc, index));
  popupStyleIndex.set(popup, index);
  return popup;
}

// Which main-window stylesheet each popup's copy came from, so the mirror can drop a copy when its source goes.
const popupStyleIndex = new WeakMap<Window, Map<Node, Element>>();
// A popup's close waiting a tick after its component unmounted (see the close effect).
const pendingCloses = new WeakMap<Window, number>();

/** Where and how big a popup is now, to open the next one the same. */
export function popupBounds(popup: Window): PopupBounds {
  return { width: popup.innerWidth, height: popup.innerHeight, left: popup.screenX, top: popup.screenY };
}

interface PopoutWindowProps {
  popup: Window;
  title: string;
  /** The browser window was closed by the DM (or went away): not called when this component closes it. */
  onClosed: () => void;
  /** Told the popup's size and position as it closes, either way. */
  onBounds?: (bounds: PopupBounds) => void;
  /** The popup body's background. */
  background?: string;
  children: ReactNode;
}

/**
 * Renders `children` into a popup opened with `openPopup`, through a portal: the same React tree, the same store and the
 * same undo history as the main page. Stylesheets added to the main page later (CSS loaded on demand, dev HMR) are
 * mirrored into it. Closing the popup (by the DM) calls `onClosed`; unmounting closes the popup; the main page going
 * away closes it too.
 */
export function PopoutWindow({ popup, title, onClosed, onBounds, background, children }: PopoutWindowProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const onBoundsRef = useRef(onBounds);
  onBoundsRef.current = onBounds;
  // Set while this component closes the popup itself, so its `pagehide` isn't taken for the DM closing it.
  const closingRef = useRef(false);

  useLayoutEffect(() => {
    const doc = popup.document;
    let root = doc.getElementById("popout-root");
    if (!root) {
      root = doc.createElement("div");
      root.id = "popout-root";
      doc.body.appendChild(root);
    }
    setContainer(root);
  }, [popup]);

  useEffect(() => {
    const doc = popup.document;
    const index = popupStyleIndex.get(popup) ?? new Map<Node, Element>();
    popupStyleIndex.set(popup, index);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element && node.matches(STYLESHEETS) && !index.has(node)) copyStylesheet(node, doc, index);
        });
        record.removedNodes.forEach((node) => {
          index.get(node)?.remove();
          index.delete(node);
        });
      }
    });
    observer.observe(document.head, { childList: true });

    function onPopupHide() {
      if (closingRef.current) return;
      onBoundsRef.current?.(popupBounds(popup));
      onClosedRef.current();
    }
    function onMainHide() {
      closingRef.current = true;
      popup.close();
    }
    popup.addEventListener("pagehide", onPopupHide);
    window.addEventListener("pagehide", onMainHide); // main-window only
    return () => {
      observer.disconnect();
      popup.removeEventListener("pagehide", onPopupHide);
      window.removeEventListener("pagehide", onMainHide); // main-window only
    };
  }, [popup]);

  // Closing the popup when this unmounts (docked or closed from the page). Strict Mode unmounts and remounts every
  // effect once in development, so the close waits a tick and a remount takes it back.
  useEffect(() => {
    const pending = pendingCloses.get(popup);
    if (pending !== undefined) {
      window.clearTimeout(pending);
      pendingCloses.delete(popup);
    }
    return () => {
      pendingCloses.set(popup, window.setTimeout(() => {
        pendingCloses.delete(popup);
        closingRef.current = true;
        if (popup.closed) return;
        onBoundsRef.current?.(popupBounds(popup));
        popup.close();
      }, 0));
    };
  }, [popup]);

  useEffect(() => {
    popup.document.title = title;
  }, [popup, title]);

  // The whole page in the app's colours, so no white shows while the browser window is resized.
  useEffect(() => {
    const doc = popup.document;
    doc.documentElement.style.colorScheme = "dark";
    doc.documentElement.style.background = background ?? "var(--ui-bg)";
    doc.body.style.margin = "0";
    doc.body.style.background = background ?? "var(--ui-bg)";
  }, [popup, background]);

  if (!container) return null;
  return createPortal(<OwnerDocumentContext.Provider value={popup.document}>{children}</OwnerDocumentContext.Provider>, container);
}

/**
 * The frame of a popped-out window: a bar with its title, the caller's controls and Dock, over a body that fills the
 * rest of the browser window.
 */
export function PopoutFrame({ title, ariaLabel, controls, onUndo, onRedo, onDock, onFocus, dropActive, onDragOver, onDragLeave, onDrop, children }: {
  title: ReactNode;
  /** Its accessible name, when `title` isn't a plain string. */
  ariaLabel?: string;
  /** In the bar, before Undo, Redo and Dock. */
  controls?: ReactNode;
  /** Undo and Redo in the bar: the main page's top bar may be on another monitor. */
  onUndo?: () => void;
  onRedo?: () => void;
  onDock: () => void;
  /** A press or focus anywhere in it. */
  onFocus?: () => void;
  dropActive?: boolean;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <div
      className={[styles.frame, dropActive ? styles.dropActive : ""].filter(Boolean).join(" ")}
      role="dialog" aria-label={ariaLabel ?? (typeof title === "string" ? title : "Window")}
      onPointerDownCapture={onFocus} onFocusCapture={onFocus}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
    >
      <header className={styles.bar}>
        <span className={styles.title}>{title}</span>
        {controls}
        {onUndo ? (
          <button type="button" className={styles.ctrl} onClick={onUndo} aria-label="Undo" title="Undo">
            <Undo2 size={14} />
          </button>
        ) : null}
        {onRedo ? (
          <button type="button" className={styles.ctrl} onClick={onRedo} aria-label="Redo" title="Redo">
            <Redo2 size={14} />
          </button>
        ) : null}
        <button type="button" className={styles.dock} onClick={onDock} title="Put this sheet back in the page">
          <PanelTopClose size={13} /> Dock
        </button>
      </header>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
