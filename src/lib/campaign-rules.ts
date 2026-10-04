import { z } from "zod";
import { getExecutableActions, type EncounterSnapshot, type RuleProfile } from "@/engine";

/**
 * The rules a campaign sets for every encounter in it. The campaign is where they're kept; an encounter takes them into
 * its snapshot's `rules` when it's opened (`withCampaignRules`), so the engine never needs to know what a campaign is,
 * and a run, a saved run or an exported encounter carries the rule it was played under.
 */
export const campaignRulesSchema = z.object({
  /** A counterer sees which spell, at what level and at whom (on), or only that a spell is being cast (off). */
  counterspellReadsSpell: z.boolean().optional()
}).strict();

export type CampaignRules = z.infer<typeof campaignRulesSchema>;

/** Each rule a campaign can set, what it's called, and the snapshot rule it sets. */
export const CAMPAIGN_RULES: Array<{ key: keyof CampaignRules & keyof RuleProfile; label: string; hint: string; on: string; off: string; byDefault: boolean }> = [
  {
    key: "counterspellReadsSpell",
    label: "Counterspellers know what's being cast and at whom",
    hint: "On: a creature that can counter a spell sees which spell it is, at what level and at whom, and weighs whether it's worth stopping. Off: it only sees that a spell is being cast, as the rules are written, and judges by what the caster could cast.",
    on: "Counterspellers know the spell",
    off: "Counterspellers only see a spell being cast",
    byDefault: true
  }
];

/** A campaign's rules from what the database holds: anything unreadable is every default. */
export function parseCampaignRules(json: string | null | undefined): CampaignRules {
  if (!json) return {};
  try {
    const parsed = campaignRulesSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** A rule's value in a campaign: its own, or the default. */
export function campaignRule(rules: CampaignRules | null | undefined, key: keyof CampaignRules): boolean {
  return rules?.[key] ?? CAMPAIGN_RULES.find((rule) => rule.key === key)!.byDefault;
}

/** The encounter with its campaign's rules written into its snapshot. The same snapshot when nothing changes. */
export function withCampaignRules(snapshot: EncounterSnapshot, rules: CampaignRules | null | undefined): EncounterSnapshot {
  let next = snapshot;
  for (const rule of CAMPAIGN_RULES) {
    const value = campaignRule(rules, rule.key);
    if ((next.rules[rule.key] ?? rule.byDefault) !== value || next.rules[rule.key] === undefined) {
      next = { ...next, rules: { ...next.rules, [rule.key]: value } };
    }
  }
  return next;
}

/** Whether anything in the encounter can counter a spell: when the counterspell rule is worth mentioning at all. */
export function hasCounterspellers(snapshot: Pick<EncounterSnapshot, "definitions">): boolean {
  return snapshot.definitions.some((definition) => getExecutableActions(definition)
    .some((action) => "reaction" in action && action.reaction?.trigger.kind === "enemy-casts-spell"));
}

/** What a rule says in an encounter, in a few words ("Counterspellers know the spell"). */
export function ruleInForce(snapshot: Pick<EncounterSnapshot, "rules">, key: keyof CampaignRules): string {
  const rule = CAMPAIGN_RULES.find((candidate) => candidate.key === key)!;
  return (snapshot.rules[key] ?? rule.byDefault) ? rule.on : rule.off;
}
