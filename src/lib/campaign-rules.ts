import { z } from "zod";
import { getExecutableActions, withItemRules, type ActionDefinition, type ConditionName, type EncounterSnapshot, type RuleProfile } from "@/engine";

/**
 * The rules a campaign sets for every encounter in it. The campaign is where they're kept; an encounter takes them into
 * its snapshot's `rules` when it's opened (`withCampaignRules`), so the engine never needs to know what a campaign is,
 * and a run, a saved run or an exported encounter carries the rule it was played under. The potion rules are also
 * written into every potion that follows them (`withItemRules`): the engine reads only what a potion says.
 */
export const campaignRulesSchema = z.object({
  /** A counterer sees which spell, at what level and at whom (on), or only that a spell is being cast (off). */
  counterspellReadsSpell: z.boolean().optional(),
  /** What drinking or giving a potion takes: an action (2014), a bonus action (2024), or a bonus action to drink and an action to give. */
  potionUse: z.enum(["action", "bonus", "drink-bonus"]).optional(),
  /** Where a bonus action would do, using an action instead heals a potion's full amount. */
  potionActionHealsFull: z.boolean().optional(),
  /**
   * The rules that differ between the editions but belong to no spell or class (EDITIONS_PLAN.md D4), each its own
   * choice: what being grappled does, whether a stunned creature can move, and what being surprised costs.
   */
  grappled: z.enum(["speed", "speed-and-attacks"]).optional(),
  stunned: z.enum(["cant-move", "can-move"]).optional(),
  surprise: z.enum(["lose-turn", "initiative"]).optional()
}).strict();

export type CampaignRules = z.infer<typeof campaignRulesSchema>;

/** The rules switched on or off. */
type ToggleKey = "counterspellReadsSpell" | "potionActionHealsFull";

export interface ToggleRule {
  kind: "toggle";
  key: ToggleKey & keyof RuleProfile;
  label: string;
  hint: string;
  on: string;
  off: string;
  byDefault: boolean;
  /** Why it doesn't apply under the campaign's other rules, when it doesn't (it's shown, switched off and greyed out). */
  inapplicable?: (rules: CampaignRules) => string | undefined;
}

/** The rules chosen from options. */
type ChoiceKey = "potionUse" | "grappled" | "stunned" | "surprise";

export interface ChoiceRule {
  kind: "choice";
  key: ChoiceKey;
  label: string;
  hint: string;
  /** Each option, its label saying which edition's rule it is where it's one of theirs. */
  options: Array<{ value: string; label: string; short: string }>;
  byDefault: string;
}

export type CampaignRuleSpec = ToggleRule | ChoiceRule;

/** Each rule a campaign can set, what it's called, and the snapshot rule it sets. */
export const CAMPAIGN_RULES: CampaignRuleSpec[] = [
  {
    kind: "toggle",
    key: "counterspellReadsSpell",
    label: "Counterspellers know what's being cast and at whom",
    hint: "On: a creature that can counter a spell sees which spell it is, at what level and at whom, and weighs whether it's worth stopping. Off: it only sees that a spell is being cast, as the rules are written, and judges by what the caster could cast.",
    on: "Counterspellers know the spell",
    off: "Counterspellers only see a spell being cast",
    byDefault: true
  },
  {
    kind: "choice",
    key: "potionUse",
    label: "Drinking or giving a potion takes",
    hint: "Every potion follows this unless it's set to keep its own timing. Giving a potion is pouring it into a creature within 5 ft: one who's down gets back up.",
    options: [
      { value: "action", label: "An action (2014 rules)", short: "Potions take an action" },
      { value: "bonus", label: "A bonus action (2024 rules)", short: "Potions take a bonus action" },
      { value: "drink-bonus", label: "A bonus action to drink, an action to give", short: "A bonus action to drink a potion, an action to give one" }
    ],
    byDefault: "action"
  },
  {
    kind: "toggle",
    key: "potionActionHealsFull",
    label: "A healing potion used with an action instead of a bonus action heals in full",
    hint: "A Potion of Healing heals 2d4 + 2 with a bonus action, or the full 10 with an action. Only where a bonus action would do: a potion given for an action under the house rule is rolled.",
    on: "An action instead heals a potion in full",
    off: "Potions are rolled however they're used",
    byDefault: false,
    inapplicable: (rules) => (campaignChoice(rules, "potionUse") === "action" ? "Potions take an action under this campaign's rule, so there's no bonus action to trade." : undefined)
  },
  {
    kind: "choice",
    key: "grappled",
    label: "Being grappled",
    hint: "Either way a grappled creature's speed is 0 until it escapes. The grappler is whoever holds it: a grapple added by hand has none, so only its speed changes.",
    options: [
      { value: "speed", label: "Speed 0 (2014 rules)", short: "Grappled: speed 0" },
      { value: "speed-and-attacks", label: "Speed 0, and disadvantage on attacks against anyone but the grappler (2024 rules)", short: "Grappled: speed 0, and disadvantage on attacks against anyone but the grappler" }
    ],
    byDefault: "speed"
  },
  {
    kind: "choice",
    key: "stunned",
    label: "Being stunned",
    hint: "Either way a stunned creature takes no actions, bonus actions or reactions, and attacks against it hit more easily. Applies to stuns from now on.",
    options: [
      { value: "cant-move", label: "Can't move (2014 rules)", short: "Stunned creatures can't move" },
      { value: "can-move", label: "Can still move (2024 rules)", short: "Stunned creatures can still move" }
    ],
    byDefault: "cant-move"
  },
  {
    kind: "choice",
    key: "surprise",
    label: "Being surprised",
    hint: "Who's surprised is set on the Combat panel before initiative is rolled.",
    options: [
      { value: "lose-turn", label: "No actions, reactions or movement on its first turn (2014 rules)", short: "Surprised creatures lose their first turn" },
      { value: "initiative", label: "Rolls initiative at disadvantage (2024 rules)", short: "Surprised creatures roll initiative at disadvantage" }
    ],
    byDefault: "lose-turn"
  }
];

const toggleRule = (key: ToggleKey) => CAMPAIGN_RULES.find((rule): rule is ToggleRule => rule.kind === "toggle" && rule.key === key)!;
const choiceRule = (key: ChoiceKey) => CAMPAIGN_RULES.find((rule): rule is ChoiceRule => rule.kind === "choice" && rule.key === key)!;

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

/** A rule switched on or off in a campaign: its own setting, or the default. */
export function campaignRule(rules: CampaignRules | null | undefined, key: ToggleKey): boolean {
  return rules?.[key] ?? toggleRule(key).byDefault;
}

/** A rule chosen from options in a campaign: its own choice, or the default. */
export function campaignChoice<K extends ChoiceKey>(rules: CampaignRules | null | undefined, key: K): NonNullable<CampaignRules[K]> {
  return (rules?.[key] ?? choiceRule(key).byDefault) as NonNullable<CampaignRules[K]>;
}

/**
 * The encounter with its campaign's rules written into its snapshot, and the potion rules into every potion that
 * follows them. The same snapshot when nothing changes.
 */
export function withCampaignRules(snapshot: EncounterSnapshot, rules: CampaignRules | null | undefined): EncounterSnapshot {
  let next = snapshot;
  for (const rule of CAMPAIGN_RULES) {
    const value = rule.kind === "toggle" ? campaignRule(rules, rule.key) : campaignChoice(rules, rule.key);
    if (next.rules[rule.key] !== value) next = { ...next, rules: { ...next.rules, [rule.key]: value } };
  }
  return withItemRules(next);
}

/** Whether anything in the encounter can counter a spell: when the counterspell rule is worth mentioning at all. */
export function hasCounterspellers(snapshot: Pick<EncounterSnapshot, "definitions">): boolean {
  return snapshot.definitions.some((definition) => getExecutableActions(definition)
    .some((action) => "reaction" in action && action.reaction?.trigger.kind === "enemy-casts-spell"));
}

/** Whether an action puts this condition on its target (a rider, or a hold for Grappled). */
function puts(action: ActionDefinition, condition: ConditionName): boolean {
  const riders = "riders" in action ? action.riders ?? [] : [];
  return riders.some((rider) => (rider.kind === "condition" && rider.condition === condition) || (condition === "grappled" && rider.kind === "hold"));
}

/** Whether anything in the encounter can grapple: when the Grappled rule is worth mentioning at all. */
export function hasGrapplers(snapshot: Pick<EncounterSnapshot, "definitions">): boolean {
  return snapshot.definitions.some((definition) => getExecutableActions(definition).some((action) => puts(action, "grappled")));
}

/** Whether anything in the encounter can stun: when the Stunned rule is worth mentioning at all. */
export function hasStunners(snapshot: Pick<EncounterSnapshot, "definitions">): boolean {
  return snapshot.definitions.some((definition) => getExecutableActions(definition).some((action) => puts(action, "stunned")));
}

/** Whether anyone in the encounter is surprised: when the surprise rule is worth mentioning at all. */
export function hasSurprised(snapshot: Pick<EncounterSnapshot, "combatants">): boolean {
  return snapshot.combatants.some((combatant) => (combatant.conditions ?? []).some((condition) => condition.name === "surprised"));
}

/** Whether anything in the encounter carries a potion: when the potion rules are worth mentioning at all. */
export function hasPotions(snapshot: Pick<EncounterSnapshot, "definitions">): boolean {
  return snapshot.definitions.some((definition) => definition.items?.some((item) => item.type === "potion"));
}

/** What a rule says in an encounter, in a few words ("Counterspellers know the spell", "Potions take a bonus action"). */
export function ruleInForce(snapshot: Pick<EncounterSnapshot, "rules">, key: keyof CampaignRules): string {
  const rule = CAMPAIGN_RULES.find((candidate) => candidate.key === key)!;
  if (rule.kind === "choice") {
    const value = snapshot.rules[rule.key] ?? rule.byDefault;
    return rule.options.find((option) => option.value === value)?.short ?? value;
  }
  return (snapshot.rules[rule.key] ?? rule.byDefault) ? rule.on : rule.off;
}

/** The potion rules in force, in a few words: "Potions take a bonus action · an action instead heals a potion in full". */
export function potionRulesInForce(snapshot: Pick<EncounterSnapshot, "rules">): string {
  const use = ruleInForce(snapshot, "potionUse");
  const full = snapshot.rules.potionActionHealsFull && (snapshot.rules.potionUse ?? "action") !== "action";
  return full ? `${use} · ${ruleInForce(snapshot, "potionActionHealsFull").replace(/^A/, "a")}` : use;
}
