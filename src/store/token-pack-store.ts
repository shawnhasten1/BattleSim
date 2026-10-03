"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { clearTokenImages, deleteTokenImage, listTokenImages, putTokenImages, type StoredTokenImage } from "@/lib/tokenPackStore";

/**
 * This browser's imported SRD token art (`tokenPackStore`), as object URLs a token can show,
 * keyed by monster slug. Hydrated once, the first time something asks for it.
 */
interface TokenPackState {
  images: Readonly<Record<string, string>>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Store images and show them at once. Resolves false if the browser couldn't keep them. */
  save: (images: StoredTokenImage[]) => Promise<boolean>;
  remove: (slug: string) => Promise<void>;
  clear: () => Promise<void>;
}

function objectUrl(blob: Blob): string | undefined {
  try {
    return typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : undefined;
  } catch {
    return undefined;
  }
}

function revoke(url: string | undefined) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Nothing to free.
  }
}

let hydrating: Promise<void> | null = null;

export const useTokenPackStore = create<TokenPackState>()((set, get) => ({
  images: {},
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return Promise.resolve();
    hydrating ??= listTokenImages().then((stored) => {
      const images: Record<string, string> = {};
      for (const { slug, blob } of stored) {
        const url = objectUrl(blob);
        if (url) images[slug] = url;
      }
      // Anything saved while this loaded is newer than what was read.
      set((state) => ({ images: { ...images, ...state.images }, hydrated: true }));
    });
    return hydrating;
  },
  save: async (stored) => {
    const ok = await putTokenImages(stored);
    if (!ok) return false;
    const images = { ...get().images };
    for (const { slug, blob } of stored) {
      const url = objectUrl(blob);
      if (!url) continue;
      revoke(images[slug]);
      images[slug] = url;
    }
    set({ images });
    return true;
  },
  remove: async (slug) => {
    await deleteTokenImage(slug);
    const { [slug]: gone, ...images } = get().images;
    revoke(gone);
    set({ images });
  },
  clear: async () => {
    await clearTokenImages();
    for (const url of Object.values(get().images)) revoke(url);
    set({ images: {} });
  }
}));

/** This browser's imported SRD token art, loading it on first use. */
export function useDeviceTokenImages(): Readonly<Record<string, string>> {
  const images = useTokenPackStore((state) => state.images);
  const hydrated = useTokenPackStore((state) => state.hydrated);
  useEffect(() => {
    if (!hydrated) void useTokenPackStore.getState().hydrate();
  }, [hydrated]);
  return images;
}

/** Test seam. */
export function __resetTokenPackForTests(): void {
  hydrating = null;
  useTokenPackStore.setState({ images: {}, hydrated: false });
}
