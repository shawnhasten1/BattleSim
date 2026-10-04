/**
 * Casting a spell with a higher slot, for the builder: what a spell's upcasting does in words, the SRD's upcasting for a
 * spell of the same name that has none (offered to the DM, never applied by itself), and the "At Higher Levels" text a
 * spell's description carries. Structured library data only; the text is shown, never parsed into data (AGENTS.md §8).
 */
import { upcastAddsSomething, type ActionDefinition, type CreatureDefinition, type SpellDefinition, type SpellUpcast } from "@/engine";
import { SRD_SPELLS } from "@/data/srd";
import { upcastOf, withUpcast } from "./spells";

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}

/**
 * What a higher slot does for a spell of `level`, in a few words: "adds 1d8 damage per level above 4th", "takes one more
 * creature per level above 1st". `heals` words dice as healing. Undefined when it does nothing (or nothing simulated).
 */
export function describeUpcast(upcast: SpellUpcast | undefined, level: number, heals = false): string | undefined {
  const per = upcast?.perSlotAboveBase;
  const parts: string[] = [];
  if (per?.damageDice) parts.push(`adds ${per.damageDice} ${heals ? "healing" : "damage"}`);
  if (per?.beams) parts.push(`fires ${per.beams === 1 ? "one more beam" : `${per.beams} more beams`}`);
  if (per?.targets) parts.push(`takes ${per.targets === 1 ? "one more creature" : `${per.targets} more creatures`}`);
  return parts.length ? `${parts.join(" and ")} per level above ${ordinal(level)}` : undefined;
}

/** A spell's name as the library would file it: "Melf's Acid Arrow" and "acid arrow" are the same spell. */
function nameKey(name: string): string {
  return name.toLowerCase().replace(/^[a-z]+'s /, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The library spell a creature's spell is: the same name and level, and not a spell from another source (an Open5e
 * entry from a different document is its own spell, even with the same name).
 */
export function srdTwin(spell: SpellDefinition): SpellDefinition | undefined {
  const provider = spell.source?.provider;
  if (provider && provider !== "homebrew" && provider !== "srd") return undefined;
  const key = nameKey(spell.name);
  return SRD_SPELLS.find((candidate) => candidate.level === spell.level && nameKey(candidate.name) === key);
}

export interface UpcastOffer {
  spellId: string;
  name: string;
  upcast: SpellUpcast;
  /** "The SRD's Blight adds 1d8 damage per level above 4th." */
  text: string;
}

/**
 * The SRD's upcasting, offered for a spell that has none of its own when the library's same spell gets stronger with a
 * higher slot in a way this one's action can use. A spell already upcasting its own way is the DM's call, and left be.
 */
export function srdUpcastOffer(spell: SpellDefinition): UpcastOffer | undefined {
  if (spell.level <= 0 || upcastOf(spell)) return undefined;
  const twin = srdTwin(spell);
  const theirs = twin ? upcastOf(twin) : undefined;
  if (!twin || !theirs?.perSlotAboveBase || !spell.action) return undefined;
  if (!upcastAddsSomething({ ...spell.action, upcast: theirs } as ActionDefinition)) return undefined;
  const words = describeUpcast(theirs, twin.level, spell.action.kind === "healing");
  return words ? { spellId: spell.id, name: spell.name, upcast: theirs, text: `The SRD's ${twin.name} ${words}.` } : undefined;
}

/** Every spell on the creature the SRD's upcasting is offered for. */
export function srdUpcastOffers(definition: Pick<CreatureDefinition, "spells">): UpcastOffer[] {
  return (definition.spells ?? []).flatMap((spell) => {
    const offer = srdUpcastOffer(spell);
    return offer ? [offer] : [];
  });
}

/** The creature's spells with the offers taken (all of them, or those named). */
export function withSrdUpcasts(spells: SpellDefinition[], offers: UpcastOffer[]): SpellDefinition[] {
  const byId = new Map(offers.map((offer) => [offer.spellId, offer]));
  return spells.map((spell) => {
    const offer = byId.get(spell.id);
    return offer ? withUpcast(spell, offer.upcast) : spell;
  });
}

/**
 * The "At Higher Levels" paragraph of a spell's description, as an import or a paste left it: the one headed so, or the
 * one that says what a spell slot of a higher level does.
 */
export function higherLevelsText(description: string | undefined): string | undefined {
  const paragraphs = (description ?? "").split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const found = paragraphs.find((paragraph) => /^\**at higher levels\b/i.test(paragraph))
    ?? paragraphs.find((paragraph) => /\b(spell slot of (a )?(\d+(st|nd|rd|th) level|higher level)|for each slot level above)/i.test(paragraph));
  return found?.replace(/^\**at higher levels\**[.:]?\s*\**\s*/i, "");
}
