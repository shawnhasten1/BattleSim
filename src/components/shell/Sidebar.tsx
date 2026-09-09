"use client";

import type { ReactNode } from "react";
import styles from "./Sidebar.module.css";

interface SidebarTab {
  id: string;
  label: string;
}

interface SidebarProps {
  tabs: ReadonlyArray<SidebarTab>;
  activeId: string;
  onSelect: (id: string) => void;
  /** Panel body for the active tab. Owned by the caller for now. */
  children: ReactNode;
}

/**
 * Right sidebar chrome: a text tab strip over a scrolling body. Phase 1 hosts
 * the legacy panel blocks as children; Phase 3 replaces the body per tab.
 */
export function Sidebar({ tabs, activeId, onSelect, children }: SidebarProps) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.tabs} role="tablist" aria-label="Sidebar sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeId}
            className={[styles.tab, tab.id === activeId ? styles.active : ""].filter(Boolean).join(" ")}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
