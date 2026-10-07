import { SRD_WEAPONS, findSrdFeature, findSrdItem, findSrdWeapon } from "@/data/srd";
import { SRD_2014_CATALOG } from "@/data/srd/2014";
import { SRD_2014_SPELL_INDEX, findSrd2014Spell, srd2014SpellId } from "@/data/srd/2014/spells";
import { SRD_2024_CATALOG } from "@/data/srd/2024";
import { SRD_2024_REFERENCE } from "@/data/srd/2024/reference";
import { findSrd2024Spell, SRD_2024_SPELL_INDEX, srd2024SpellId } from "@/data/srd/2024/spells";
import type { BuilderLibrary, BuildSources } from "./build";
import type { Catalog } from "./catalog";

/** A weapon kind's id: its SRD 5.2 name, kebab-cased (`light-crossbow`). */
export const weaponKindId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const KINDS = new Map(SRD_2024_REFERENCE.weapons.map((weapon) => [weaponKindId(weapon.name), { name: weapon.name, mastery: weapon.mastery ?? "" }]));

/** The suffix a 2014 class's spell list key carries (`wizard-2014`), beside the 2024 list (`wizard`). */
export const LIST_2014 = "-2014";

/** Each class's spell list: the 2024 spells whose own entry names the class (`"wizard"`), and the 2014 ones (`"wizard-2014"`). */
const SPELL_LISTS = new Map<string, string[]>();
const addTo = (list: string, id: string) => SPELL_LISTS.set(list, [...(SPELL_LISTS.get(list) ?? []), id]);
for (const entry of SRD_2024_SPELL_INDEX.spells) for (const list of entry.classes) addTo(list, srd2024SpellId(entry.slug));
for (const entry of SRD_2014_SPELL_INDEX.spells) for (const list of entry.classes) addTo(`${list}${LIST_2014}`, srd2014SpellId(entry.slug));

/** The SRD's class spell lists by key (`"wizard"`, `"wizard-2014"`), for a homebrew class to cast from. */
export const SRD_SPELL_LISTS: string[] = [...SPELL_LISTS.keys()].sort();

/** The library's plain weapons: what a 2014 "any martial weapon" line chooses from. */
const PLAIN_WEAPONS = SRD_WEAPONS.filter((weapon) => !weapon.magical).map((weapon) => weapon.id);

/**
 * The bundled library, as the builder reads it. Spells of both editions: a 2024 spell's id ends `-2024` (plan D12), a
 * 2014 one is the library's own (`srd:spell:fireball`), authored or reference only (EDITIONS_PLAN.md).
 */
export const SRD_BUILDER_LIBRARY: BuilderLibrary = {
  feature: findSrdFeature,
  weapon: findSrdWeapon,
  item: findSrdItem,
  weaponKind: (kind) => KINDS.get(kind),
  weaponKinds: () => [...KINDS.keys()],
  weaponRefs: () => PLAIN_WEAPONS,
  spell: (id) => findSrd2024Spell(id) ?? findSrd2014Spell(id),
  spellsOn: (list) => SPELL_LISTS.get(list) ?? []
};

/** The two bundled catalogs as one: the 2024 entries, then the 2014 ones. Their ids never collide. */
const SRD_CATALOG: Catalog = {
  classes: [...SRD_2024_CATALOG.classes, ...SRD_2014_CATALOG.classes],
  subclasses: [...SRD_2024_CATALOG.subclasses, ...SRD_2014_CATALOG.subclasses],
  feats: [...SRD_2024_CATALOG.feats, ...SRD_2014_CATALOG.feats],
  backgrounds: [...SRD_2024_CATALOG.backgrounds, ...SRD_2014_CATALOG.backgrounds],
  species: [...SRD_2024_CATALOG.species, ...SRD_2014_CATALOG.species]
};

/** What a character is built from by default: both SRD catalogs (5.2 and 5.1) and the bundled library. */
export const SRD_BUILD_SOURCES: BuildSources = { catalog: SRD_CATALOG, library: SRD_BUILDER_LIBRARY };
