"use client";

import { useState } from "react";
import { CAMPAIGN_RULES, campaignRule, type CampaignRules as Rules } from "@/lib/campaign-rules";
import { useEncounterStore } from "@/store/encounter-store";
import styles from "./campaigns.module.css";

/**
 * The rules every encounter in the campaign plays by: a toggle each, saved as it's switched. An encounter takes them as
 * it opens (and an open one at once), so a run records the rule it ran under.
 */
export function CampaignRules({ campaignId, rules, onChange }: { campaignId: string; rules: Rules; onChange: (next: Rules) => void }) {
  const setCampaignRules = useEncounterStore((s) => s.setCampaignRules);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function toggle(key: keyof Rules, on: boolean) {
    const before = rules;
    const next = { ...rules, [key]: on };
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
      {CAMPAIGN_RULES.map((rule) => (
        <label key={rule.key} className={styles.rule}>
          <input type="checkbox" checked={campaignRule(rules, rule.key)} disabled={saving} onChange={(event) => void toggle(rule.key, event.target.checked)} />
          <span>
            <strong>{rule.label}</strong>
            <span className={styles.ruleHint}>{rule.hint}</span>
          </span>
        </label>
      ))}
      {problem ? <p className={styles.status} role="alert">{problem}</p> : null}
    </section>
  );
}
