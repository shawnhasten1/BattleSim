import type { ItemDefinition, SpellDefinition } from "@/engine";
import { itemSpellUse } from "./item-spells";
import { srd51Source } from "./source";
import { SRD_SPELLS } from "./spells";

/**
 * Spell scrolls (SRD 5.1 "Spell Scroll", ITEMS_PLAN.md §7, D8): a scroll of any spell, made from the spell. Reading it
 * casts the spell at the scroll's own save DC and attack bonus, which go by the spell's level, and the scroll is gone.
 */
export const SCROLL_NUMBERS: ReadonlyArray<{ upTo: number; dc: number; attack: number }> = [
  { upTo: 2, dc: 13, attack: 5 },
  { upTo: 4, dc: 15, attack: 7 },
  { upTo: 6, dc: 17, attack: 9 },
  { upTo: 8, dc: 18, attack: 10 },
  { upTo: 9, dc: 19, attack: 11 }
];

/** A scroll's save DC and attack bonus for a spell of `level` (a cantrip is a scroll's lowest). */
export function scrollNumbers(level: number): { dc: number; attack: number } {
  const row = SCROLL_NUMBERS.find((candidate) => level <= candidate.upTo) ?? SCROLL_NUMBERS[SCROLL_NUMBERS.length - 1]!;
  return { dc: row.dc, attack: row.attack };
}

const LEVEL_WORDS = ["cantrip", "1st-level spell", "2nd-level spell", "3rd-level spell", "4th-level spell", "5th-level spell", "6th-level spell", "7th-level spell", "8th-level spell", "9th-level spell"];

/** "Scroll of Fireball": one scroll that casts `spell` at the scroll's numbers when it's read. */
export function spellScroll(spell: SpellDefinition, id: string): ItemDefinition {
  const numbers = scrollNumbers(spell.level);
  const use = itemSpellUse(spell, numbers, { id: "read" });
  const rarity = spell.level <= 1 ? "common" : spell.level <= 3 ? "uncommon" : spell.level <= 5 ? "rare" : spell.level <= 8 ? "very rare" : "legendary";
  const what = LEVEL_WORDS[spell.level] ?? `${spell.level}th-level spell`;
  return {
    id,
    name: `Scroll of ${spell.name}`,
    type: "scroll",
    magical: true,
    description: `A ${rarity} spell scroll of ${spell.name} (a ${what}). Reading it casts the spell with the scroll's save DC ${numbers.dc} and attack bonus +${numbers.attack}, and the scroll crumbles to dust. A creature can read it only if the spell is on its class's spell list; if it can't yet cast spells of that level, it must succeed on a check with its spellcasting ability (DC 10 + the spell's level) or the scroll is wasted.`,
    supply: { id: "supply", size: 1, unit: "count" },
    ...(use ? { grantedActions: [use] } : {}),
    automationSupport: use && (use.automationSupport === "full" || use.automationSupport === "partial") ? use.automationSupport : "manual-only"
  };
}

/** A scroll of every spell in the library, `srd:item:scroll-of-<spell slug>`: found by name ("scroll fireball"), never listed by default. */
export const SRD_SPELL_SCROLLS: readonly ItemDefinition[] = SRD_SPELLS.map((spell) => {
  const id = `srd:item:scroll-of-${spell.id.replace(/^srd:spell:/, "")}`;
  return { ...spellScroll(spell, id), source: srd51Source(id) };
});
