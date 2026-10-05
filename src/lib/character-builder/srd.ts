import { findSrdFeature, findSrdItem, findSrdWeapon } from "@/data/srd";
import { SRD_2024_CATALOG } from "@/data/srd/2024";
import { SRD_2024_REFERENCE } from "@/data/srd/2024/reference";
import { findSrd2024Spell, SRD_2024_SPELL_INDEX, srd2024SpellId } from "@/data/srd/2024/spells";
import type { BuilderLibrary, BuildSources } from "./build";

/** A weapon kind's id: its SRD 5.2 name, kebab-cased (`light-crossbow`). */
export const weaponKindId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const KINDS = new Map(SRD_2024_REFERENCE.weapons.map((weapon) => [weaponKindId(weapon.name), { name: weapon.name, mastery: weapon.mastery ?? "" }]));

/** Each class's spell list (`"wizard"`): the 2024 spells whose own entry names the class. */
const SPELL_LISTS = new Map<string, string[]>();
for (const entry of SRD_2024_SPELL_INDEX.spells) {
  for (const list of entry.classes) SPELL_LISTS.set(list, [...(SPELL_LISTS.get(list) ?? []), srd2024SpellId(entry.slug)]);
}

/** The bundled library, as the builder reads it. Spells are the 2024 ones (plan D12). */
export const SRD_BUILDER_LIBRARY: BuilderLibrary = {
  feature: findSrdFeature,
  weapon: findSrdWeapon,
  item: findSrdItem,
  weaponKind: (kind) => KINDS.get(kind),
  weaponKinds: () => [...KINDS.keys()],
  spell: findSrd2024Spell,
  spellsOn: (list) => SPELL_LISTS.get(list) ?? []
};

/** What a character is built from by default: the SRD 5.2 catalog and the bundled library. */
export const SRD_BUILD_SOURCES: BuildSources = { catalog: SRD_2024_CATALOG, library: SRD_BUILDER_LIBRARY };
