"use client";

import type { ReactNode } from "react";
import styles from "./PanelFooter.module.css";

/**
 * Sticky action bar at the bottom of a sidebar panel. Direct <button> children
 * are styled by the footer; mark the emphasized one with `data-primary`.
 */
export function PanelFooter({ children }: { children: ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}
