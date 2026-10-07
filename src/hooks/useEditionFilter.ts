"use client";

import { useState } from "react";
import { readJson, writeJson } from "@/lib/persist";
import { isEditionChoice, type Edition, type EditionChoice } from "@/lib/editions";

/**
 * A list's edition filter (EDITIONS_PLAN.md D2): the last choice made on this list in this browser, Both if none. A built
 * character's lists open on its own edition instead (`characterEdition`), and a change made there isn't remembered for
 * the others: it's for that character only.
 */
export function useEditionFilter(list: string, characterEdition?: Edition): [EditionChoice, (next: EditionChoice) => void] {
  const key = `editionFilter.${list}`;
  const [choice, setChoice] = useState<EditionChoice>(() => {
    if (characterEdition) return characterEdition;
    const stored = readJson<unknown>(key, "both");
    return isEditionChoice(stored) ? stored : "both";
  });
  function choose(next: EditionChoice) {
    setChoice(next);
    if (!characterEdition) writeJson(key, next);
  }
  return [choice, choose];
}
