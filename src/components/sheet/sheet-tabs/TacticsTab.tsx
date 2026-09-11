"use client";

import type { ActorTag, CombatantState, CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { TACTICS_PROFILES } from "@/lib/tactics-profiles";
import { RESOURCE_STANCES } from "@/lib/resource-stances";
import styles from "../sheet.module.css";

const TAGS: { value: ActorTag; label: string; hint: string }[] = [
  { value: "high-priority", label: "High priority", hint: "Enemies chase this target harder (e.g. a brute beelines it)." },
  { value: "low-priority", label: "Low priority", hint: "Enemies deprioritize attacking and healing this actor." },
  { value: "protected", label: "Protected", hint: "Allies guard this actor even at full HP and heal it first." }
];

const TACTICS_PROFILE_HELP = (
  <dl>
    {TACTICS_PROFILES.map((option) => (
      <div key={option.value}>
        <dt>{option.label}</dt>
        <dd>{option.description}</dd>
      </div>
    ))}
  </dl>
);

const RESOURCE_STANCE_HELP = (
  <dl>
    {RESOURCE_STANCES.map((option) => (
      <div key={option.value}>
        <dt>{option.label}</dt>
        <dd>{option.description}</dd>
      </div>
    ))}
  </dl>
);

const TAGS_HELP = (
  <dl>
    {TAGS.map((tag) => (
      <div key={tag.value}>
        <dt>{tag.label}</dt>
        <dd>{tag.hint}</dd>
      </div>
    ))}
  </dl>
);

export function TacticsTab({ combatant }: { combatant: CombatantState; definition: CreatureDefinition }) {
  const updateTactics = useEncounterStore((s) => s.updateTactics);
  const updateResourceStance = useEncounterStore((s) => s.updateResourceStance);
  const updateTags = useEncounterStore((s) => s.updateTags);
  const tags = combatant.tags ?? [];

  const toggleTag = (tag: ActorTag) => {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    updateTags(combatant.id, next.length > 0 ? next : undefined);
  };

  return (
    <div className={styles.tab}>
      <section className={styles.section}>
        <h3>AI tactics</h3>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Profile
              <InfoTooltip label="About tactics profiles" content={TACTICS_PROFILE_HELP} />
            </span>
            <select
              value={combatant.tacticsProfile}
              onChange={(e) => updateTactics(combatant.id, e.target.value as typeof combatant.tacticsProfile)}
            >
              {TACTICS_PROFILES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Resource stance
              <InfoTooltip label="About resource stances" content={RESOURCE_STANCE_HELP} />
            </span>
            <select
              value={combatant.resourceStance}
              onChange={(e) => updateResourceStance(combatant.id, e.target.value as typeof combatant.resourceStance)}
            >
              {RESOURCE_STANCES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Faction
            <input value={combatant.faction} readOnly />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.fieldLabel}>
          Tags
          <InfoTooltip label="About tags" content={TAGS_HELP} />
        </h3>
        <div className={styles.stack}>
          {TAGS.map((tag) => (
            <label key={tag.value} className={`${styles.field} ${styles.checkLine}`} title={tag.hint}>
              <input
                type="checkbox"
                checked={tags.includes(tag.value)}
                onChange={() => toggleTag(tag.value)}
              />
              {tag.label}
            </label>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3>Simulation assumptions</h3>
        <p className={styles.note}>
          <span>Pathing respects walls, terrain, occupancy, and footprint size.</span>
          <span>The AI only considers actions with full automation support.</span>
          <span>Reference-only and unsupported content is skipped by batch runs.</span>
        </p>
      </section>
    </div>
  );
}
