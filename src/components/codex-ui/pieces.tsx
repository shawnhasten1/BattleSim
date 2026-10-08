"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Astrolabe } from "./ornaments";
import ui from "./codex-ui.module.css";

/** Character Codex's small heading glyphs. */
export const CODEX_ICONS = {
  bag: "M9 3h6a1 1 0 0 1 1 1v3h3.5A1.5 1.5 0 0 1 21 8.5V12h-7v-1h-4v1H3V8.5A1.5 1.5 0 0 1 4.5 7H8V4a1 1 0 0 1 1-1zm1 2v2h4V5h-4zM3 13.5h7V15h4v-1.5h7v6A1.5 1.5 0 0 1 19.5 21h-15A1.5 1.5 0 0 1 3 19.5v-6z",
  shield: "M12 2l8 3v6.2c0 5-3.4 9.1-8 10.8-4.6-1.7-8-5.8-8-10.8V5l8-3z",
  compass: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm3.5 4.5L13.4 13.4 8.5 15.5l2.1-4.9z",
  chest: "M9 3h6a1 1 0 0 1 1 1v3h3.5A1.5 1.5 0 0 1 21 8.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-11A1.5 1.5 0 0 1 4.5 7H8V4a1 1 0 0 1 1-1zm1 2v2h4V5h-4z",
  star: "M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z",
  sword: "M19.5 2H22v2.5L11.4 15.1l1.6 1.6-1.4 1.4-1.6-1.6L7 19.5l1 1-1.4 1.4-4.5-4.5L3.5 16l1 1 2.9-3-1.6-1.6 1.4-1.4 1.6 1.6z",
  diamond: "M12 2l10 10-10 10L2 12z"
} as const;

export type CodexIcon = keyof typeof CODEX_ICONS;

/** A panel's heading, with Character Codex's small copper glyph and a rule to the panel's edge. */
export function CodexHeading({ id, icon, className, level = 2, children }: {
  id?: string;
  icon: CodexIcon;
  className?: string;
  /** The heading level: 2 on the sheet, 3 inside the builder's steps. */
  level?: 2 | 3;
  children: ReactNode;
}) {
  const Tag = level === 3 ? "h3" : "h2";
  return (
    <Tag className={className ? `${ui.ph} ${className}` : ui.ph} id={id}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={CODEX_ICONS[icon]} /></svg>
      {children}
    </Tag>
  );
}

/** The teal banner across the top, with its astrolabe; what's in it is the caller's. */
export function CodexBanner({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className ? `${ui.band} ${className}` : ui.band}>
      <Astrolabe />
      <section className={ui.bandInner} aria-label={label}>{children}</section>
    </div>
  );
}

/** The class for the number inside a level dial (an output, a typed box or a select). */
export const LEVEL_VALUE_CLASS = ui.lvValue;

/** The level dial: a ring of copper ticks around its number (the caller's: `LEVEL_VALUE_CLASS`) and its label. */
export function LevelDial({ label, title, className, children }: { label: string; title?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className ? `${ui.lv} ${className}` : ui.lv} title={title}>
      {children}
      <span className={ui.lvLabel} aria-hidden="true">{label}</span>
    </div>
  );
}

/** The class for the score inside an ability dial. */
export const ABILITY_SCORE_CLASS = ui.abScore;

/** One ability's dial: its name, the score in the ring (the caller's: `ABILITY_SCORE_CLASS`) and the modifier under it. */
export function AbilityDial({ name, score, mod, modLabel, className }: {
  name: ReactNode;
  score: ReactNode;
  mod: ReactNode;
  modLabel: string;
  className?: string;
}) {
  return (
    <div className={className ? `${ui.ab} ${className}` : ui.ab}>
      <span className={ui.abName}>{name}</span>
      <div className={ui.dial}>{score}</div>
      <output className={ui.abMod} aria-label={modLabel}>{mod}</output>
    </div>
  );
}

/**
 * Tabs in a pill track, the chosen one copper. The arrow keys, Home and End move between them (Character Codex.html's
 * roving tabindex), and only the chosen tab is in the Tab order.
 */
export function CodexTabs<T extends string>({ tabs, value, onChange, label, className }: {
  tabs: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0
          : event.key === "End" ? last
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  }
  return (
    <div className={className ? `${ui.tabs} ${className}` : ui.tabs} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(node) => { refs.current[index] = node; }}
          type="button" role="tab" className={ui.tab}
          aria-selected={tab.id === value} tabIndex={tab.id === value ? 0 : -1}
          onClick={() => onChange(tab.id)} onKeyDown={(event) => onKeyDown(event, index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
