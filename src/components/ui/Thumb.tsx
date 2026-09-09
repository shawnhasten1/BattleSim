"use client";

import styles from "./Thumb.module.css";

interface ThumbProps {
  /** Image data URL or remote URL. When absent, `fallback` is shown. */
  imageUrl?: string | null;
  /** Shown when there is no image — initials (e.g. "Go") or a single glyph. */
  fallback: string;
  /** Square edge length in px. Default 34 (list rows). */
  size?: number;
  /** Optional faction/state border tint. */
  borderColor?: string;
}

/** Square avatar chip for list rows and cards. */
export function Thumb({ imageUrl, fallback, size = 34, borderColor }: ThumbProps) {
  return (
    <div className={styles.thumb} style={{ width: size, height: size, borderColor }}>
      {imageUrl ? <img src={imageUrl} alt="" draggable={false} /> : <span>{fallback}</span>}
    </div>
  );
}
