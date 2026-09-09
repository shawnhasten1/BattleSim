"use client";

import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

interface AppShellProps {
  topBar: ReactNode;
  rail: ReactNode;
  /** The scene canvas. Fills the center slot on both axes. */
  main: ReactNode;
  sidebar: ReactNode;
}

/**
 * The shell frame: 44px top bar, then a row of [52px rail | canvas | 320px
 * sidebar]. Pure layout — each region owns its own background and borders.
 * Sets the dark surface, font, and color-scheme that everything inside
 * inherits.
 */
export function AppShell({ topBar, rail, main, sidebar }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <div className={styles.topbar}>{topBar}</div>
      <div className={styles.body}>
        <div className={styles.rail}>{rail}</div>
        <div className={styles.main}>{main}</div>
        <div className={styles.sidebar}>{sidebar}</div>
      </div>
    </div>
  );
}
