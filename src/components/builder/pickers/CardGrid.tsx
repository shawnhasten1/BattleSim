"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useRulesCard, type EntrySource } from "@/components/rules-card";
import styles from "../builder.module.css";

export interface CardOption {
  id: string;
  title: string;
  /** Beside the title: its edition, or where it's from. */
  badge?: string;
  /** Quiet lines under the title: "Medium · 30 ft · Darkvision 120". */
  lines?: string[];
  /** A line in the accent colour: a 2014 race's "+2 CON". */
  accent?: string;
  /** A glyph (an SVG path on a 512 box): a class's or a species' icon. */
  icon?: string;
  /** Why it can't be chosen; it's shown, dimmed, and its card says why. */
  blocked?: string;
  /** Its rules card. */
  card?: EntrySource;
  /** The builder's suggestion: marked ✦ (a sensible default to start from). */
  suggested?: boolean;
}

/**
 * A choice of one, as cards (D6): a radio group, the arrow keys moving through it, each card showing its rules card on
 * hover or focus. Groups (2024 rules, 2014 rules, homebrew) get small headings.
 */
export function CardGrid({ label, groups, value, onChange, columns = 3, extra }: {
  label: string;
  groups: ReadonlyArray<{ label?: string; options: CardOption[] }>;
  value: string | undefined;
  onChange: (id: string) => void;
  columns?: number;
  /** After the cards (a "None" card, a homebrew note). */
  extra?: ReactNode;
}) {
  const cards = useRulesCard();
  const all = groups.flatMap((group) => group.options);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const focusable = all.find((option) => option.id === value) ?? all[0];

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, option: CardOption) {
    const index = all.indexOf(option);
    const last = all.length - 1;
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0
          : event.key === "End" ? last
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const target = all[next]!;
    refs.current.get(target.id)?.focus();
    if (!target.blocked) onChange(target.id);
  }

  return (
    <div role="radiogroup" aria-label={label} className={styles.cardGroups}>
      {groups.map((group, index) => (
        <div key={group.label ?? index} className={styles.cardGroup}>
          {group.label && groups.length > 1 ? <p className={styles.cardGroupLabel}>{group.label}</p> : null}
          <div className={styles.cardGrid} data-columns={columns}>
            {group.options.map((option) => {
              const on = option.id === value;
              const bound = cards.bind(option.card);
              return (
                <button
                  key={option.id}
                  ref={(node) => { if (node) refs.current.set(option.id, node); else refs.current.delete(option.id); }}
                  type="button" role="radio" aria-checked={on} aria-disabled={option.blocked ? true : undefined}
                  aria-label={option.badge ? `${option.title} (${option.badge})` : option.title}
                  tabIndex={option === focusable ? 0 : -1}
                  className={styles.optionCard}
                  {...bound}
                  onKeyDown={(event) => { bound.onKeyDown(event); onKeyDown(event, option); }}
                  onClick={() => { if (!option.blocked && !on) onChange(option.id); }}
                >
                  {option.icon ? (
                    <svg className={styles.optionIcon} viewBox="0 0 512 512" aria-hidden="true"><path d={option.icon} /></svg>
                  ) : null}
                  <span className={styles.optionText}>
                    <span className={styles.optionTitle}>
                      <strong>{option.title}</strong>
                      {option.badge ? <span className={styles.optionBadge}>{option.badge}</span> : null}
                      {option.suggested ? <span className={styles.suggestMark} aria-hidden="true" title="The builder's suggestion">✦</span> : null}
                    </span>
                    {(option.lines ?? []).map((line) => <span key={line} className={styles.optionLine}>{line}</span>)}
                    {option.accent ? <span className={styles.optionAccent}>{option.accent}</span> : null}
                    {option.blocked ? <span className={styles.optionLine}>{option.blocked}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {extra}
    </div>
  );
}
