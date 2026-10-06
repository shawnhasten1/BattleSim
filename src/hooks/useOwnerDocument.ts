"use client";

import { createContext, useContext } from "react";

/**
 * The document a component renders into. A sheet popped out into its own browser window renders there through a
 * portal, while its code still runs in the main window, so `document` and `window` would mean the main one.
 */
export const OwnerDocumentContext = createContext<Document | null>(null);

/**
 * The document this component is in: a popped-out sheet's, or the main one. On the server there is none; callers only
 * touch it in effects, handlers, and popups that open after a click.
 */
export function useOwnerDocument(): Document {
  const owner = useContext(OwnerDocumentContext);
  return owner ?? (typeof document === "undefined" ? (undefined as unknown as Document) : document);
}

/** The window this component is in (see `useOwnerDocument`). */
export function useOwnerWindow(): Window & typeof globalThis {
  const owner = useOwnerDocument();
  const view = owner?.defaultView ?? (typeof window === "undefined" ? undefined : window);
  return view as Window & typeof globalThis;
}
