"use client";

import styles from "./HpBar.module.css";

interface HpBarProps {
  current: number;
  max: number;
  /** Track width. Number = px. Omit to fill the parent. */
  width?: number | string;
  /**
   * "auto" (default) is green above half HP and red at or below half.
   * "green"/"red" force a color (e.g. faction-tinted bars).
   */
  tone?: "auto" | "green" | "red";
}

/** Horizontal HP fill bar. Used on tokens, list rows, and the actor sheet. */
export function HpBar({ current, max, width, tone = "auto" }: HpBarProps) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  const color =
    tone === "green"
      ? "var(--ui-hp-green)"
      : tone === "red"
        ? "var(--ui-hp-red)"
        : ratio <= 0.5
          ? "var(--ui-hp-red)"
          : "var(--ui-hp-green)";

  return (
    <div className={styles.track} style={{ width }}>
      <i className={styles.fill} style={{ width: `${ratio * 100}%`, background: color }} />
    </div>
  );
}
