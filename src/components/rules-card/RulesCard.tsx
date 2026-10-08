"use client";

import { forwardRef, type CSSProperties, type HTMLAttributes } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { plainText, type RulesEntry, type Support } from "@/lib/character-builder/describe";
import { toneColor } from "./tones";
import styles from "./rules-card.module.css";

export const SUPPORT_WORDS: Record<Support, string> = {
  full: "Runs in the simulator",
  partial: "Partly simulated: the DM runs the rest",
  manual: "Not simulated: the DM runs it",
  info: "Reference only: it plays no part in a fight"
};

/** A support dot (D8): filled runs, half partly, hollow the DM runs it. Its words are its title and accessible name. */
export function SupportDot({ support, className }: { support: Support; className?: string }) {
  return (
    <span className={className ? `${styles.dot} ${className}` : styles.dot} data-support={support} role="img" aria-label={SUPPORT_WORDS[support]} title={SUPPORT_WORDS[support]} />
  );
}

/** The short text a hover card shows: its first two paragraphs, plain, the second cut short. */
function shortText(text: string): { paragraphs: string[]; more: boolean } {
  const all = text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map(plainText).filter((paragraph) => paragraph && paragraph !== "You gain the following benefits.");
  const paragraphs = all.slice(0, 2).map((paragraph) => (paragraph.length > 300 ? `${paragraph.slice(0, 300).replace(/\s+\S*$/, "")}…` : paragraph));
  return { paragraphs, more: all.length > 2 || all.some((paragraph) => paragraph.length > 300) };
}

type CardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  entry: RulesEntry;
  /** `hover`: the short card; `full`: all of its text (pinned, or in a pane). */
  variant: "hover" | "full";
  /** In the flow of a pane rather than floating. */
  inline?: boolean;
  /** "Read all": pins the full card. */
  onPin?: () => void;
  onClose?: () => void;
};

/**
 * A rules card: its name and edition, what it is, its facts, what it gives, its text, what the simulator does with it,
 * and why it can't be chosen when it can't. The same card on hover (short) and pinned (all of it).
 */
export const RulesCard = forwardRef<HTMLElement, CardProps>(function RulesCard({ entry, variant, inline, onPin, onClose, className, style, ...rest }, ref) {
  const short = variant === "hover" ? shortText(entry.text) : undefined;
  const tone = toneColor(entry.tone);
  const classes = [styles.card, variant === "full" ? styles.full : "", inline ? styles.inline : "", className].filter(Boolean).join(" ");
  return (
    <aside ref={ref} {...rest} className={classes} style={{ ...(tone ? ({ "--tone": tone } as CSSProperties) : {}), ...style }} aria-label={`${entry.title}: rules`}>
      <div className={styles.head}>
        <h3 className={styles.title}>{entry.title}</h3>
        {entry.source ? <span className={styles.badge}>{entry.source}</span> : null}
        {entry.edition ? <span className={styles.badge} title={`The ${entry.edition} rules`}>{entry.edition}</span> : null}
        {onClose ? <button type="button" className={styles.close} aria-label={`Close ${entry.title}`} onClick={onClose}>×</button> : null}
      </div>
      {entry.subtitle ? <p className={styles.subtitle}>{entry.subtitle}</p> : null}
      {entry.facts.length ? (
        <div className={styles.facts}>{entry.facts.map((fact) => <span key={fact} className={styles.fact}>{fact}</span>)}</div>
      ) : null}
      {entry.effect ? <p className={styles.effect}>{entry.effect}</p> : null}
      {entry.gives.length ? (
        <dl className={styles.gives}>
          {entry.gives.map((row) => (
            <div key={`${row.label}|${row.value}`} style={{ display: "contents" }}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {short ? (
        short.paragraphs.length ? <div className={styles.text}>{short.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div> : null
      ) : entry.text ? (
        <div className={styles.text}><Markdown remarkPlugins={[remarkGfm]}>{entry.text}</Markdown></div>
      ) : null}
      {entry.higherLevels && (variant === "full" || !short?.more) ? <p className={styles.higher}>{entry.kind === "spell" ? "At higher levels: " : ""}{entry.higherLevels}</p> : null}
      {entry.support ? (
        <div className={styles.support}>
          <SupportDot support={entry.support} />
          <span>{SUPPORT_WORDS[entry.support]}{entry.notSimulated && variant === "full" ? `. Not simulated: ${entry.notSimulated}` : ""}</span>
        </div>
      ) : null}
      {entry.blocked ? <p className={styles.blocked}>{entry.blocked}</p> : null}
      {short?.more && onPin ? <button type="button" className={styles.more} onClick={onPin}>Read all ›</button> : null}
    </aside>
  );
});
