"use client";

import { useState } from "react";
import type { CombatantState, CreatureDefinition } from "@/engine";
import { readJson, writeJson } from "@/lib/persist";
import { StatsCore } from "../stats/StatsCore";
import { DefensesSection, LevelSection, SensesSection, SkillsSection } from "../stats/StatsSections";
import styles from "../sheet.module.css";

/** Which of the Stats tab's sections are open, per browser. */
const OPEN_KEY = "actor-sheet-stats-open";

/**
 * The creature as a statblock reads (plan §3.2): its core always in view, then folding sections whose summaries read
 * like the statblock's lines. Its spellcasting ability and its resources are on the Abilities tab, by what spends them.
 */
export function StatsTab({ definition, focusName }: {
  combatant: CombatantState;
  definition: CreatureDefinition;
  /** Focus the name, selected, ready to rename (a creature just made from a token). */
  focusName?: boolean;
}) {
  const [open, setOpen] = useState<string[]>(() => readJson<string[]>(OPEN_KEY, []));
  const toggle = (id: string) => () => {
    const next = open.includes(id) ? open.filter((entry) => entry !== id) : [...open, id];
    setOpen(next);
    writeJson(OPEN_KEY, next);
  };
  return (
    <div className={styles.tab}>
      <StatsCore definition={definition} focusName={focusName} />
      <SkillsSection definition={definition} open={open.includes("skills")} onToggle={toggle("skills")} />
      <DefensesSection definition={definition} open={open.includes("defenses")} onToggle={toggle("defenses")} />
      <SensesSection definition={definition} open={open.includes("senses")} onToggle={toggle("senses")} />
      <LevelSection definition={definition} open={open.includes("level")} onToggle={toggle("level")} />
    </div>
  );
}
