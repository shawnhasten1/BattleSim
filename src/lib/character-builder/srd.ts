import { findSrdFeature, findSrdItem, findSrdWeapon } from "@/data/srd";
import { SRD_2024_CATALOG } from "@/data/srd/2024";
import { SRD_2024_REFERENCE } from "@/data/srd/2024/reference";
import type { BuilderLibrary, BuildSources } from "./build";

/** A weapon kind's id: its SRD 5.2 name, kebab-cased (`light-crossbow`). */
export const weaponKindId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const KINDS = new Map(SRD_2024_REFERENCE.weapons.map((weapon) => [weaponKindId(weapon.name), { name: weapon.name, mastery: weapon.mastery ?? "" }]));

/** The bundled library, as the builder reads it. */
export const SRD_BUILDER_LIBRARY: BuilderLibrary = {
  feature: findSrdFeature,
  weapon: findSrdWeapon,
  item: findSrdItem,
  weaponKind: (kind) => KINDS.get(kind),
  weaponKinds: () => [...KINDS.keys()]
};

/** What a character is built from by default: the SRD 5.2 catalog and the bundled library. */
export const SRD_BUILD_SOURCES: BuildSources = { catalog: SRD_2024_CATALOG, library: SRD_BUILDER_LIBRARY };
