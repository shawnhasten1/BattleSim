"use client";

import { useId, type ReactNode } from "react";
import { armorClassOf, DEX_CAP, type ArmorCategory, type CreatureDefinition, type ItemDefinition, type ItemSupply, type ItemType } from "@/engine";
import {
  drinkTiming,
  fullHealAmount,
  giveTiming,
  hasBonusUse,
  itemUseChoices,
  potionTimingText,
  supplyIdOf,
  withArmor,
  withAttuned,
  withDrinkTiming,
  withGiveTiming,
  withItemType,
  withSupply
} from "@/lib/ability-editor/items";
import type { SectionId } from "@/lib/ability-editor/sections";
import { Check, Field, NumberField, Segmented } from "./controls";
import { FeatureEffectCards } from "./FeatureEffectCards";
import { GrantsSection, type OpenGranted } from "./FeatureSections";
import type { NewPools } from "./LimitPicker";
import styles from "./ability-editor.module.css";

export interface ItemSectionProps {
  item: ItemDefinition;
  onChange: (next: ItemDefinition) => void;
  definition: CreatureDefinition;
  newPools: NewPools;
  onOpenGranted: OpenGranted;
}

/** A copy without `key`, or with it set. */
function opt<T extends object, K extends keyof T>(record: T, key: K, value: T[K] | undefined): T {
  const next = { ...record };
  delete next[key];
  return value === undefined ? next : { ...next, [key]: value };
}

const TYPES: Array<{ value: ItemType; label: string; title: string }> = [
  { value: "potion", label: "Potion", title: "Drunk, or given to a creature within 5 ft; used up one at a time" },
  { value: "scroll", label: "Scroll", title: "Read to cast its spell; used up" },
  { value: "wand", label: "Wand", title: "Spends charges on what it casts, and stays" },
  { value: "thrown", label: "Thrown", title: "A flask or a vial thrown at a creature; used up" },
  { value: "worn", label: "Worn", title: "A ring, a cloak, an amulet: works while it's carried" },
  { value: "armor", label: "Armor", title: "A suit of armor: worn, its AC replaces the creature's AC without armor" },
  { value: "shield", label: "Shield", title: "A shield: worn, it adds to the creature's AC" },
  { value: "gear", label: "Gear", title: "Anything else it carries" }
];

/** A section of an item: Basics, Use & cost, What it does, While carried, Notes & AI. */
export function itemSection(id: SectionId, props: ItemSectionProps): ReactNode {
  const { item, onChange, definition, newPools, onOpenGranted } = props;
  switch (id) {
    case "basics":
      return <ItemBasics item={item} onChange={onChange} />;
    case "armor":
      return <ArmorSection item={item} onChange={onChange} definition={definition} />;
    case "use":
      return <ItemUse item={item} onChange={onChange} />;
    case "grants":
      return (
        <GrantsSection
          record={item} onChange={onChange} definition={definition} onOpenGranted={onOpenGranted}
          choices={itemUseChoices(item)} copy="itemUses" addLabel="Add what using it does"
        />
      );
    case "while-active":
      return (
        <FeatureEffectCards
          groups={[{ id: "always", place: "always", effects: item.effects ?? [], onChange: (effects) => onChange(opt(item, "effects", effects.length ? effects : undefined)) }]}
          definition={definition}
          newPools={newPools}
          emptyText="Nothing while it's carried."
        />
      );
    case "notes":
      return <ItemNotes item={item} onChange={onChange} />;
    default:
      return null;
  }
}

function ItemBasics({ item, onChange }: { item: ItemDefinition; onChange: (next: ItemDefinition) => void }) {
  return (
    <>
      <Field copy="itemType">
        <Segmented label="It's" value={item.type} options={TYPES} onChange={(type) => onChange(withItemType(item, type))} />
      </Field>
      <Check copy="itemMagical" checked={item.magical === true} onChange={(on) => onChange(opt(item, "magical", on ? true : undefined))} />
      <Check copy="itemAttunement" checked={Boolean(item.attunement)} onChange={(on) => onChange(opt(item, "attunement", on ? { attuned: true } : undefined))} />
      {item.attunement ? (
        <Check copy="itemAttuned" checked={item.attunement.attuned} onChange={(attuned) => onChange(withAttuned(item, attuned))} />
      ) : null}
    </>
  );
}

const REGAINS: Array<{ value: string; label: string }> = [
  { value: "dawn", label: "At dawn" },
  { value: "short-rest", label: "On a short rest" },
  { value: "long-rest", label: "On a long rest" },
  { value: "never", label: "Never" }
];

/** Its stack (how many each token starts with) or its charges, and for a potion what drinking and giving it take. */
function ItemUse({ item, onChange }: { item: ItemDefinition; onChange: (next: ItemDefinition) => void }) {
  const countId = useId();
  const regainsId = useId();
  const supply = item.supply;
  const stack = item.type === "potion" || item.type === "scroll" || item.type === "thrown";
  const charges = supply?.unit === "charges";
  const setSupply = (next: ItemSupply | undefined) => onChange(withSupply(item, next));
  const regains = typeof supply?.regains === "string" ? supply.regains : supply?.regains ? "dice" : "never";
  return (
    <>
      {stack ? (
        <Field copy="itemCount" id={countId}>
          <NumberField
            id={countId} value={supply?.size ?? 1} min={0} max={99}
            onChange={(n) => n !== undefined && setSupply({ id: supplyIdOf(item), unit: "count", ...supply, size: n })}
          />
        </Field>
      ) : (
        <Check
          copy="itemCharges" checked={charges}
          onChange={(on) => setSupply(on ? { id: supplyIdOf(item), size: 7, unit: "charges", regains: "dawn" } : undefined)}
        />
      )}
      {charges && supply ? (
        <div className={styles.row}>
          <Field copy="itemChargesMax" id={countId}>
            <NumberField id={countId} value={supply.size} min={0} max={99} onChange={(n) => n !== undefined && setSupply({ ...supply, size: n })} />
          </Field>
          <Field copy="itemRegains" id={regainsId}>
            <select
              id={regainsId} value={regains}
              onChange={(event) => {
                const value = event.target.value;
                const { regains: _regains, ...rest } = supply;
                setSupply(value === "never" ? rest : value === "dice" ? supply : { ...rest, regains: value as "dawn" | "short-rest" | "long-rest" });
              }}
            >
              {REGAINS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              {regains === "dice" ? <option value="dice">By a roll</option> : null}
            </select>
          </Field>
        </div>
      ) : null}
      <p className={styles.hint}>
        {stack || charges
          ? "What every token of this creature starts a fight with: a token's own count is its Left in the resource list. A fight spends them; Restart refills them."
          : "Without charges, what it does is used at will."}
      </p>
      {item.type === "potion" ? <PotionTiming item={item} onChange={onChange} /> : null}
    </>
  );
}

/**
 * What drinking and giving a potion take: the campaign's rule, said but not set here (the editor writes the rule into a
 * potion that follows it as it's edited, as the store does on save), or its own.
 */
function PotionTiming({ item, onChange }: { item: ItemDefinition; onChange: (next: ItemDefinition) => void }) {
  const follows = item.followsTableRule !== false;
  const full = fullHealAmount(item);
  const bonusUse = hasBonusUse(item);
  return (
    <>
      <Field copy="potionTiming">
        <Segmented
          label="What using it takes" value={follows ? "table" : "own"}
          options={[{ value: "table", label: "The campaign's rule" }, { value: "own", label: "Its own" }]}
          onChange={(value) => onChange(value === "table" ? opt(item, "followsTableRule", undefined) : { ...item, followsTableRule: false })}
        />
      </Field>
      {follows ? (
        <>
          <p className={styles.hint} aria-label="Under the campaign's rule">{potionTimingText(item)}</p>
          <Check copy="potionGiven" checked={Boolean(item.give)} onChange={(on) => onChange(withGiveTiming(item, on ? "action" : "never"))} />
        </>
      ) : (
        <>
          <Field copy="drinkTakes">
            <Segmented
              label="Drinking it takes" value={drinkTiming(item)}
              options={[{ value: "action", label: "An action" }, { value: "bonus", label: "A bonus action" }]}
              onChange={(slot) => onChange(withDrinkTiming(item, slot))}
            />
          </Field>
          <Field copy="giveTakes">
            <Segmented
              label="Giving it to a creature within 5 ft" value={giveTiming(item)}
              options={[{ value: "action", label: "An action" }, { value: "bonus", label: "A bonus action" }, { value: "never", label: "Can't" }]}
              onChange={(slot) => onChange(withGiveTiming(item, slot))}
            />
          </Field>
          {full !== undefined ? (
            <Check
              copy="potionFull" label={`An action instead of a bonus action heals the full ${full}`}
              checked={item.fullWithAction === true && bonusUse} disabled={!bonusUse}
              title={bonusUse ? undefined : "Neither drinking nor giving it takes a bonus action, so there's nothing to trade"}
              onChange={(on) => onChange(opt(item, "fullWithAction", on ? true : undefined))}
            />
          ) : null}
        </>
      )}
    </>
  );
}

const WEIGHTS: Array<{ value: Exclude<ArmorCategory, "shield">; label: string; title: string }> = [
  { value: "light", label: "Light", title: "Adds all of the wearer's Dexterity modifier" },
  { value: "medium", label: "Medium", title: "Adds the wearer's Dexterity modifier, at most +2" },
  { value: "heavy", label: "Heavy", title: "Adds no Dexterity" }
];
const MAGIC: Array<{ value: string; label: string }> = [{ value: "0", label: "None" }, { value: "1", label: "+1" }, { value: "2", label: "+2" }, { value: "3", label: "+3" }];

/**
 * Armor's or a shield's AC: its weight, its AC, its magic, the Dexterity it adds and the Strength it needs, stealth,
 * and whether it's worn. Says what it makes this creature's AC.
 */
function ArmorSection({ item, onChange, definition }: { item: ItemDefinition; onChange: (next: ItemDefinition) => void; definition: CreatureDefinition }) {
  const acId = useId();
  const dexId = useId();
  const strengthId = useId();
  const shield = item.type === "shield";
  const stats = item.armor ?? (shield ? { category: "shield" as const, ac: 2 } : { category: "light" as const, ac: 11 });
  const set = (patch: Parameters<typeof withArmor>[1]) => onChange(withArmor(item, patch));
  const weightCap = stats.category === "shield" ? 0 : DEX_CAP[stats.category];
  // What it makes this creature's AC worn (the creature's other armor counting as it does).
  const placed = armorClassOf({ ...definition, items: [...(definition.items ?? []).filter((other) => other.id !== item.id), { ...item, equipped: undefined }] });
  const counts = shield ? placed.shield?.id === item.id : placed.armor?.id === item.id;
  return (
    <>
      {shield ? null : (
        <Field copy="armorWeight">
          <Segmented label="Weight" value={stats.category === "shield" ? undefined : stats.category} options={WEIGHTS} onChange={(category) => set({ category })} />
        </Field>
      )}
      <div className={styles.row}>
        <Field copy={shield ? "shieldAc" : "armorAc"} id={acId}>
          <NumberField id={acId} value={stats.ac} min={0} max={30} onChange={(n) => n !== undefined && set({ ac: n })} />
        </Field>
        <Field copy="armorMagic">
          <Segmented label="Magic bonus" value={String(stats.magicBonus ?? 0)} options={MAGIC} onChange={(value) => set({ magicBonus: Number(value) || undefined })} />
        </Field>
      </div>
      {shield ? null : (
        <div className={styles.row}>
          <Field copy="armorMaxDex" id={dexId}>
            <NumberField
              id={dexId} value={stats.maxDex} min={0} max={10} optional
              placeholder={weightCap === undefined ? "all" : String(weightCap)} onChange={(n) => set({ maxDex: n })}
            />
          </Field>
          <Field copy="armorStrength" id={strengthId}>
            <NumberField id={strengthId} value={stats.strength} min={1} max={30} optional placeholder="none" onChange={(n) => set({ strength: n })} />
          </Field>
        </div>
      )}
      {shield ? null : <Check copy="armorStealth" checked={stats.stealthDisadvantage === true} onChange={(on) => set({ stealthDisadvantage: on || undefined })} />}
      <Check copy="armorWorn" checked={item.equipped !== false} onChange={(on) => onChange(opt(item, "equipped", on ? undefined : false))} />
      <p className={styles.hint} aria-label="What it makes the AC">
        {counts
          ? `Worn, ${definition.name}'s AC is ${placed.total} (${placed.parts.map((part) => `${part.label} ${part.value}`).join(" + ")}), before rings, features and conditions.`
          : `${definition.name} wears better ${shield ? "a shield" : "armor"} already (${(shield ? placed.shield : placed.armor)?.name}): only the better one counts.`}
      </p>
    </>
  );
}

function ItemNotes({ item, onChange }: { item: ItemDefinition; onChange: (next: ItemDefinition) => void }) {
  const id = useId();
  const reference = item.automationSupport === "manual-only" || item.automationSupport === "unsupported";
  return (
    <>
      <Field copy="description" id={id}>
        <textarea
          id={id} value={item.description ?? ""} placeholder="What it is, where it came from, its rules text."
          onChange={(event) => onChange(opt(item, "description", event.target.value || undefined))}
        />
      </Field>
      <Field copy="automation">
        <Segmented
          label="The simulator" value={reference ? "reference" : "simulated"}
          options={[{ value: "simulated", label: "Uses it" }, { value: "reference", label: "Reference only" }]}
          onChange={(next) => onChange({ ...item, automationSupport: next === "simulated" ? "full" : "manual-only" })}
        />
      </Field>
    </>
  );
}
