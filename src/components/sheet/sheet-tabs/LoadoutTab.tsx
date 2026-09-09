"use client";

import { Plus, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { type Ability, type CombatantState, type CreatureDefinition, type DamageType } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import type { Compendium } from "@/hooks/useCompendium";
import { buildSheetItems } from "@/lib/sheet";
import { EditableItemList, SelectAbility, SelectDamageType } from "../SheetControls";
import styles from "../sheet.module.css";

interface SpellSearchResult {
  key: string;
  slug: string;
  name: string;
  level?: number;
  documentKey?: string;
  documentTitle?: string;
}

export function LoadoutTab({ definition, compendium }: { combatant: CombatantState; definition: CreatureDefinition; compendium: Compendium }) {
  const addWeapon = useEncounterStore((s) => s.addWeapon);
  const addSpell = useEncounterStore((s) => s.addSpell);
  const removeDefinitionItem = useEncounterStore((s) => s.removeDefinitionItem);

  const [weaponForm, setWeaponForm] = useState({
    name: "Longsword",
    attackType: "melee" as "melee" | "ranged",
    ability: "str" as Ability,
    range: 5,
    reach: 5,
    damageDice: "1d8",
    damageType: "slashing" as DamageType
  });
  const [spellForm, setSpellForm] = useState({
    name: "Fire Bolt",
    level: 0,
    castingTime: "action" as "action" | "bonus" | "reaction",
    ability: "int" as Ability,
    range: 120,
    damageDice: "1d10",
    damageType: "fire" as DamageType,
    resourceId: ""
  });
  const [spellQuery, setSpellQuery] = useState("fire bolt");
  const [spellResults, setSpellResults] = useState<SpellSearchResult[]>([]);

  const items = buildSheetItems(definition);

  async function searchSpells() {
    compendium.setStatus("Searching spells");
    const response = await fetch(`/api/open5e/spells?query=${encodeURIComponent(spellQuery)}&limit=10`);
    if (!response.ok) {
      compendium.setStatus("Spell search failed");
      return;
    }
    const data = (await response.json()) as { results: SpellSearchResult[] };
    setSpellResults(data.results);
    compendium.setStatus(`${data.results.length} spell results`);
  }

  return (
    <div className={styles.tab}>
      <section className={styles.section}>
        <h3>Weapons</h3>
        <div className={styles.stack}>
          <input value={weaponForm.name} onChange={(e) => setWeaponForm({ ...weaponForm, name: e.target.value })} aria-label="Weapon name" />
          <div className={styles.grid}>
            <select value={weaponForm.attackType} onChange={(e) => setWeaponForm({ ...weaponForm, attackType: e.target.value as "melee" | "ranged" })} aria-label="Weapon type">
              <option value="melee">Melee</option>
              <option value="ranged">Ranged</option>
            </select>
            <SelectAbility value={weaponForm.ability} onChange={(ability) => setWeaponForm({ ...weaponForm, ability })} />
            <input type="number" value={weaponForm.range} onChange={(e) => setWeaponForm({ ...weaponForm, range: Number(e.target.value) })} aria-label="Range" />
            <input value={weaponForm.damageDice} onChange={(e) => setWeaponForm({ ...weaponForm, damageDice: e.target.value })} aria-label="Damage dice" />
            <SelectDamageType value={weaponForm.damageType} onChange={(damageType) => setWeaponForm({ ...weaponForm, damageType })} />
          </div>
        </div>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => {
            addWeapon(definition.id, weaponForm);
            setWeaponForm({ ...weaponForm, name: "New Weapon" });
          }}
        >
          <Plus size={14} /> Add weapon
        </button>
        <EditableItemList items={items.weapons} definitionId={definition.id} onRemove={removeDefinitionItem} />
      </section>

      <section className={styles.section}>
        <h3>Spells</h3>
        <div className={styles.stack}>
          <input value={spellForm.name} onChange={(e) => setSpellForm({ ...spellForm, name: e.target.value })} aria-label="Spell name" />
          <div className={styles.grid}>
            <input type="number" value={spellForm.level} onChange={(e) => setSpellForm({ ...spellForm, level: Number(e.target.value) })} aria-label="Level" />
            <select value={spellForm.castingTime} onChange={(e) => setSpellForm({ ...spellForm, castingTime: e.target.value as typeof spellForm.castingTime })} aria-label="Casting time">
              <option value="action">Action</option>
              <option value="bonus">Bonus</option>
              <option value="reaction">Reaction</option>
            </select>
            <SelectAbility value={spellForm.ability} onChange={(ability) => setSpellForm({ ...spellForm, ability })} />
            <input type="number" value={spellForm.range} onChange={(e) => setSpellForm({ ...spellForm, range: Number(e.target.value) })} aria-label="Range" />
            <input value={spellForm.damageDice} onChange={(e) => setSpellForm({ ...spellForm, damageDice: e.target.value })} aria-label="Damage dice" />
            <SelectDamageType value={spellForm.damageType} onChange={(damageType) => setSpellForm({ ...spellForm, damageType })} />
            <input value={spellForm.resourceId} placeholder="slot-1" onChange={(e) => setSpellForm({ ...spellForm, resourceId: e.target.value })} aria-label="Resource" />
          </div>
        </div>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => {
            addSpell(definition.id, { ...spellForm, resourceId: spellForm.resourceId.trim() || undefined });
            setSpellForm({ ...spellForm, name: "New Spell" });
          }}
        >
          <Sparkles size={14} /> Add spell
        </button>
        <EditableItemList items={items.spells} definitionId={definition.id} onRemove={removeDefinitionItem} />

        <div className={styles.searchRow}>
          <input value={spellQuery} onChange={(e) => setSpellQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void searchSpells(); }} aria-label="Open5e spell search" />
          <button type="button" onClick={() => void searchSpells()} title="Search Open5e spells">
            <Search size={14} />
          </button>
        </div>
        <div className={styles.resultList}>
          {spellResults.map((result, index) => (
            <button
              key={result.key || `${result.documentKey ?? "doc"}-${result.slug}-${index}`}
              type="button"
              onClick={() => void compendium.importSpell(result.slug, definition.id)}
            >
              <strong>{result.name}</strong>
              <span>level {result.level ?? 0} · {result.documentTitle ?? result.documentKey ?? "Open5e"}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
