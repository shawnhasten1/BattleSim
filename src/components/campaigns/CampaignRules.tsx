"use client";

import { useState } from "react";
import type { PotionUse } from "@/engine";
import { CAMPAIGN_RULES, campaignChoice, campaignRule, type CampaignRules as Rules } from "@/lib/campaign-rules";
import { useEncounterStore } from "@/store/encounter-store";
import styles from "./campaigns.module.css";

/**
 * The rules every encounter in the campaign plays by: a toggle or a choice each, saved as it's set. An encounter takes
 * them as it opens (and an open one at once), so a run records the rule it ran under. A rule that does nothing under the
 * campaign's other rules is greyed out, and says why.
 */
export function CampaignRules({ campaignId, rules, onChange }: { campaignId: string; rules: Rules; onChange: (next: Rules) => void }) {
  const setCampaignRules = useEncounterStore((s) => s.setCampaignRules);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save(change: Rules) {
    const before = rules;
    const next = { ...rules, ...change };
    onChange(next);
    setSaving(true);
    setProblem(null);
    const saved = await setCampaignRules(campaignId, next);
    setSaving(false);
    if (!saved) {
      onChange(before);
      setProblem("Couldn't save the campaign's rules. Try again.");
    }
  }

  return (
    <section className={styles.rules} aria-label="Campaign rules">
      <h3>Campaign rules</h3>
      <p className={styles.rulesNote}>Every encounter in this campaign plays by these.</p>
      {CAMPAIGN_RULES.map((rule) => {
        if (rule.kind === "choice") {
          return (
            <div key={rule.key} className={styles.rule}>
              <span>
                <strong>{rule.label}</strong>
                <select aria-label={rule.label} value={campaignChoice(rules, rule.key)} disabled={saving} onChange={(event) => void save({ [rule.key]: event.target.value as PotionUse })}>
                  {rule.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <span className={styles.ruleHint}>{rule.hint}</span>
              </span>
            </div>
          );
        }
        const inapplicable = rule.inapplicable?.(rules);
        return (
          <label key={rule.key} className={styles.rule} data-inapplicable={inapplicable ? "" : undefined}>
            <input type="checkbox" checked={!inapplicable && campaignRule(rules, rule.key)} disabled={saving || Boolean(inapplicable)} onChange={(event) => void save({ [rule.key]: event.target.checked })} />
            <span>
              <strong>{rule.label}</strong>
              <span className={styles.ruleHint}>{rule.hint}</span>
              {inapplicable ? <span className={styles.ruleHint}>{inapplicable}</span> : null}
            </span>
          </label>
        );
      })}
      {problem ? <p className={styles.status} role="alert">{problem}</p> : null}
    </section>
  );
}
