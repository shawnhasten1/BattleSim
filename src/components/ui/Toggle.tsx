"use client";

import styles from "./Toggle.module.css";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name — the visible label lives next to the control. */
  label: string;
}

/** iOS-style switch used for scene/grid options. */
export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={[styles.toggle, checked ? styles.on : ""].filter(Boolean).join(" ")}
      onClick={() => onChange(!checked)}
    >
      <i className={styles.knob} />
    </button>
  );
}
