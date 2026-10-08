"use client";

import type { ReactNode } from "react";
import { CodexHeading, type CodexIcon } from "@/components/codex-ui";
import { SupportDot, useRulesCard, type EntrySource } from "@/components/rules-card";
import { firstParagraph, type Support } from "@/lib/character-builder";
import { useBuilder } from "./builder-context";
import styles from "./builder.module.css";

/**
 * A class's, species' or spell school's icon (D14): a game-icons glyph drawn as a mask, so it takes the colour around
 * it (the accent on a card) in either look. Nothing without a `src` (homebrew).
 */
export function BuilderIcon({ src, className }: { src: string | undefined; className?: string }) {
  if (!src) return null;
  return (
    <span
      aria-hidden="true" className={className ? `${styles.builderIcon} ${className}` : styles.builderIcon}
      style={{ WebkitMaskImage: `url(${src})`, maskImage: `url(${src})` }}
    />
  );
}

/** A step's section heading: the Codex's, with its copper glyph and rule, or Standard's small capitals. */
export function StepHeading({ icon = "diamond", children, aside }: { icon?: CodexIcon; children: ReactNode; aside?: ReactNode }) {
  const { look } = useBuilder();
  return (
    <div className={styles.stepHead}>
      {look === "codex"
        ? <CodexHeading icon={icon} level={3} className={styles.codexHeading}>{children}</CodexHeading>
        : <h3 className={styles.standardHeading}>{children}</h3>}
      {aside}
    </div>
  );
}

/** A panel of a step: a Codex card, or a Standard section. */
export function Panel({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <section aria-label={label} className={className ? `${styles.panel} ${className}` : styles.panel}>{children}</section>;
}

/**
 * A feature in a list (the timeline's, a species' traits, the preview's): whether the simulator runs it, its name, what
 * gave it, and its first line; its rules card on hover or focus.
 */
export function FeatureRow({ name, support, text, from, card }: {
  name: string;
  support?: Support;
  text?: string;
  /** What gave it, when it isn't what the list is about ("Evoker", "level 3"). */
  from?: string;
  card: EntrySource;
}) {
  const cards = useRulesCard();
  return (
    <button type="button" className={styles.featureRow} {...cards.bind(card)}>
      {support ? <SupportDot support={support} /> : <span className={styles.dotSpace} />}
      <strong>{name}</strong>
      {from ? <span className={styles.optionBadge}>{from}</span> : null}
      <span className={styles.featureLine}>{text ? firstParagraph(text) : ""}</span>
    </button>
  );
}

/** What something gives, a label and its value a row, with a link where it's set elsewhere. */
export function Gives({ rows }: { rows: Array<{ label: string; value: ReactNode; link?: { text: string; go: () => void } }> }) {
  return (
    <dl className={styles.gives}>
      {rows.map((row) => (
        <div key={row.label} className={styles.givesRow}>
          <dt>{row.label}</dt>
          <dd>
            {row.value}
            {row.link ? <button type="button" className={styles.linkButton} onClick={row.link.go}>{row.link.text}</button> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
