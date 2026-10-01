"use client";

import { inferSpellcastingAbility, type Ability, type CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { spellcastingFacts, type ListGroup } from "@/lib/ability-editor/list";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import styles from "./abilities.module.css";

const ABILITY_NAMES: Record<Ability, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

/** The spellcasting abilities first (INT, WIS, CHA), then the rest for unusual casters. */
const CHOICES: Ability[] = ["int", "wis", "cha", "str", "dex", "con"];

const HELP = (
  <p>
    The ability its spells use for their save DC and spell attack bonus (8 + this modifier + proficiency, and this
    modifier + proficiency). A spell can use its own ability instead, set in the spell&apos;s Roll section. Auto uses the
    ability its spells name most, or else its highest of INT, WIS and CHA. Its level, on the Stats tab, scales its
    cantrips.
  </p>
);

/** The Spellcasting group's heading: its ability to pick, then its save DC, attack bonus and caster level. */
export function SpellcastingHeading({ definition, facts }: { definition: CreatureDefinition; facts: NonNullable<ListGroup["spellcasting"]> }) {
  const updateCreatureDefinition = useEncounterStore((s) => s.updateCreatureDefinition);
  return (
    <span className={styles.groupNote}>
      <select
        className={styles.castingAbility}
        aria-label="Spellcasting ability"
        value={definition.spellcasting?.ability ?? ""}
        onChange={(event) => updateCreatureDefinition(definition.id, { spellcasting: event.target.value ? { ability: event.target.value as Ability } : undefined })}
      >
        <option value="">Auto: {ABILITY_NAMES[inferSpellcastingAbility(definition)]}</option>
        {CHOICES.map((ability) => <option key={ability} value={ability}>{ABILITY_NAMES[ability]}</option>)}
      </select>
      {" · "}{spellcastingFacts(facts)}
      <InfoTooltip label="About spellcasting ability" content={HELP} />
    </span>
  );
}
