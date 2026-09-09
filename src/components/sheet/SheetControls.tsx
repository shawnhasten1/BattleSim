"use client";

import { Trash2 } from "lucide-react";
import { type Ability, type DamageType } from "@/engine";
import { AutomationBadge } from "@/components/ui/AutomationBadge";
import type { SheetItem, SheetItemType } from "@/lib/sheet";
import styles from "./sheet.module.css";

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const DAMAGE_TYPES: DamageType[] = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder"
];

export function SelectAbility({ value, onChange }: { value: Ability; onChange: (ability: Ability) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as Ability)} aria-label="Ability">
      {ABILITIES.map((ability) => (
        <option key={ability} value={ability}>{ability.toUpperCase()}</option>
      ))}
    </select>
  );
}

export function SelectDamageType({ value, onChange }: { value: DamageType; onChange: (type: DamageType) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as DamageType)} aria-label="Damage type">
      {DAMAGE_TYPES.map((type) => (
        <option key={type} value={type}>{type}</option>
      ))}
    </select>
  );
}

interface EditableItemListProps {
  items: SheetItem[];
  definitionId: string;
  onRemove: (definitionId: string, itemType: SheetItemType, itemId: string) => void;
}

export function EditableItemList({ items, definitionId, onRemove }: EditableItemListProps) {
  if (items.length === 0) return null;
  return (
    <div className={styles.itemList}>
      {items.map((item) => (
        <div key={`${item.type}-${item.id}`} className={styles.item}>
          <div className={styles.itemMain}>
            <strong>{item.name}</strong>
            <span>{item.detail}</span>
            {item.automationSupport ? <AutomationBadge value={item.automationSupport} /> : null}
          </div>
          <button
            type="button"
            className={styles.itemRemove}
            onClick={() => onRemove(definitionId, item.type, item.id)}
            title={`Remove ${item.type}`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
