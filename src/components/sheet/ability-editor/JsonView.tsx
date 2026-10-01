"use client";

import { useEffect, useState } from "react";
import { recordJson, type DiffLine, type JsonCheck } from "@/lib/ability-editor/json";
import type { AbilityRecord } from "@/lib/ability-editor/refs";
import styles from "./ability-editor.module.css";

/** How many unchanged lines to show around a change. */
const CONTEXT = 2;

/** The changed lines with a little context around each, and "…" where unchanged lines are left out. */
function hunks(diff: DiffLine[]): Array<DiffLine | "gap"> {
  const near = diff.map((_, index) => diff.slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1).some((line) => line.kind !== "same"));
  const out: Array<DiffLine | "gap"> = [];
  diff.forEach((line, index) => {
    if (near[index]) out.push(line);
    else if (out[out.length - 1] !== "gap") out.push("gap");
  });
  return out;
}

const MARK: Record<DiffLine["kind"], string> = { same: " ", added: "+", removed: "−" };

/**
 * The ability as JSON (plan D6). Check validates and normalizes what's typed and shows what would change; Apply puts it
 * in the editor. Edits elsewhere in the editor show here until the text is changed.
 */
export function JsonView({ record, check, onApply }: {
  record: AbilityRecord;
  check: (text: string) => JsonCheck;
  onApply: (record: AbilityRecord) => void;
}) {
  const [text, setText] = useState(() => recordJson(record));
  const [edited, setEdited] = useState(false);
  const [result, setResult] = useState<JsonCheck | null>(null);

  useEffect(() => {
    if (!edited) setText(recordJson(record));
  }, [record, edited]);

  function reset() {
    setText(recordJson(record));
    setEdited(false);
    setResult(null);
  }

  return (
    <div className={styles.json}>
      <textarea
        aria-label="The record as JSON" spellCheck={false} value={text} rows={14}
        onChange={(event) => { setText(event.target.value); setEdited(true); setResult(null); }}
      />
      <div className={styles.jsonBar}>
        <button type="button" className={styles.btn} onClick={() => setResult(check(text))}>Check</button>
        <button type="button" className={styles.btn} disabled={!edited} onClick={reset}>Reset</button>
        {result?.ok && result.changed ? (
          <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => { onApply(result.record); setEdited(false); setResult(null); }}>
            Apply
          </button>
        ) : null}
        <span className={styles.hint}>Ids are kept as they are: other abilities point at them.</span>
      </div>
      {result && !result.ok ? (
        <ul className={styles.jsonProblems} role="alert" aria-label="Problems">
          {result.problems.map((problem, index) => (
            <li key={index}>{problem.path ? <code>{problem.path}</code> : null}{problem.path ? ": " : ""}{problem.message}</li>
          ))}
        </ul>
      ) : null}
      {result?.ok ? (
        result.changed ? (
          <pre className={styles.diff} aria-label="What changes">
            {hunks(result.diff).map((line, index) => (line === "gap"
              ? <span key={index} className={styles.diffGap}>…{"\n"}</span>
              : <span key={index} className={line.kind === "added" ? styles.diffAdded : line.kind === "removed" ? styles.diffRemoved : undefined}>{MARK[line.kind]} {line.text}{"\n"}</span>))}
          </pre>
        ) : (
          <p className={styles.hint} role="status">Nothing changes: it&apos;s the same ability.</p>
        )
      ) : null}
    </div>
  );
}
