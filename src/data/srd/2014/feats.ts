import type { Ability } from "@/engine";
import type { FeatDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../source";
import { informational, reference, runs } from "./authoring";
import { srd14FeatureText } from "./reference";

/**
 * The 2014 feats (SRD 5.1): the Ability Score Improvement a class's feat levels offer, Grappler (SRD 5.1's one feat), and
 * the six fighting styles a Fighter (and a Champion) chooses from, as fighting-style feats the way the 2024 rules have
 * them. Under the 2014 rules a fighting style is a class feature's option, not a feat: here it's a feat so the builder's
 * one Fighting Style choice serves both editions.
 */

const ANY: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/** A fighting style's text: its section of the Fighter's Fighting Style feature ("###Archery"). */
function styleText(name: string): string {
  const sections = srd14FeatureText("fighter_fighting-style").split(/^#+\s*/m).slice(1);
  const section = sections.find((entry) => entry.startsWith(name));
  if (!section) throw new Error(`No fighting style ${name} in SRD 5.1`);
  return section.slice(name.length).trim();
}

/** The audit's key for a style: an option of the Fighting Style feature (\`srd_fighter_fighting-style:Dueling\`). */
const style = (name: string) => ({ name, text: styleText(name), slug: `srd_fighter_fighting-style:${name}` });

function fightingStyle(slug: string, name: string, feature: FeatDefinition["grants"][number]["feature"]): FeatDefinition {
  return {
    id: `srd:feat:${slug}-2014`,
    name,
    source: srd51Source(`srd_fighter_fighting-style:${name}`),
    edition: "2014",
    category: "fighting-style",
    prerequisite: { feature: "Fighting Style" },
    grants: [{ key: "feat", feature }]
  };
}

export const SRD_2014_FEATS: FeatDefinition[] = [
  {
    id: "srd:feat:ability-score-improvement-2014",
    name: "Ability Score Improvement",
    source: srd51Source("srd:feat:ability-score-improvement-2014"),
    edition: "2014",
    category: "general",
    repeatable: true,
    grants: [{
      key: "feat",
      feature: informational({
        name: "Ability Score Improvement",
        text: "Increase one ability score of your choice by 2, or two ability scores of your choice by 1. As normal, you can't increase an ability score above 20 using this feature.",
        slug: "srd:feat:ability-score-improvement-2014"
      })
    }],
    choices: [{ kind: "abilities", id: "increase", label: "+2 to one score, or +1 to two", points: 2, from: ANY, maxPerAbility: 2, cap: 20 }]
  },
  {
    id: "srd:feat:grappler-2014",
    name: "Grappler",
    source: srd51Source("srd_grappler"),
    edition: "2014",
    category: "general",
    prerequisite: { abilities: { str: 13 }, text: "Strength 13 or higher" },
    grants: [{
      key: "feat",
      feature: runs({ feat: "grappler" }, {
        effects: [{ kind: "attack-advantage", condition: "target-grappled-by-self" }],
        notSimulated: "pinning a creature you're grappling (both of you restrained)."
      })
    }]
  },
  fightingStyle("archery", "Archery", runs(style("Archery"), { effects: [{ kind: "attack-bonus", bonus: { base: 2 }, attackTypes: ["ranged"] }] })),
  fightingStyle("defense", "Defense", runs(style("Defense"), { effects: [{ kind: "armor-class-bonus", bonus: { base: 1 }, armor: "worn" }] })),
  fightingStyle("dueling", "Dueling", runs(style("Dueling"), {
    effects: [{ kind: "damage-bonus", condition: "always", attackTypes: ["melee"], damage: [{ dice: "2", damageType: "same-as-attack" }] }],
    notSimulated: "that the weapon is held in one hand with no other weapon: every melee weapon attack gets the +2."
  })),
  // 2014's rerolls 1s and 2s; the engine has 2024's "treat them as 3" but no reroll, so it's the DM's.
  fightingStyle("great-weapon-fighting", "Great Weapon Fighting", reference(style("Great Weapon Fighting"))),
  fightingStyle("protection", "Protection", runs(style("Protection"), {
    grantedActions: [{
      kind: "activate-feature", id: "protection", name: "Protection", actionType: "reaction", featureId: "",
      reaction: { trigger: { kind: "ally-targeted-by-attack", withinFt: 5 }, target: "trigger-target", priority: "worthwhile" },
      automationSupport: "full"
    }],
    notSimulated: "that it wields a shield."
  })),
  // The simulator already adds the ability modifier to a light weapon's off-hand attack, so there's nothing to switch on.
  fightingStyle("two-weapon-fighting", "Two-Weapon Fighting", runs(style("Two-Weapon Fighting")))
];
