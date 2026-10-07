import type { BackgroundDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../source";
import { informational } from "./authoring";
import { srd14Background } from "./reference";

/**
 * The 2014 backgrounds (SRD 5.1): the Acolyte, its one. Two skills and a feature of its own; no ability increases and no
 * feat (its character's increases come from its race, or the 2024 rule's three points: \`increasesFrom\`). Its gear isn't
 * a weapon or armor, so nothing of it reaches the sheet.
 */
const acolyte = srd14Background("acolyte");

export const SRD_2014_BACKGROUNDS: BackgroundDefinition[] = [
  {
    id: "srd:background:acolyte-2014",
    name: "Acolyte",
    source: srd51Source(acolyte.key),
    edition: "2014",
    skills: acolyte.skills,
    grants: [{
      key: "shelter-of-the-faithful",
      feature: informational({ name: acolyte.feature.name, text: acolyte.feature.text, slug: `${acolyte.key}:${acolyte.feature.name}` })
    }],
    description: "You have spent your life in the service of a temple, acting as an intermediary between the realm of the holy and the mortal world."
  }
];
