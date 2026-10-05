import type { BackgroundDefinition } from "@/lib/character-builder/catalog";
import { srd52Source } from "./reference";

const coin = (gold: number) => ({ id: "B", label: `${gold} GP`, items: [], gold });

/** The SRD 5.2's four backgrounds: three abilities for +2 and +1 (or +1 each), two skills and an origin feat. */
export const SRD_2024_BACKGROUNDS: BackgroundDefinition[] = [
  {
    id: "srd:background:acolyte",
    name: "Acolyte",
    source: srd52Source("srd-2024_acolyte"),
    edition: "2024",
    abilities: ["int", "wis", "cha"],
    skills: ["insight", "religion"],
    feat: "srd:feat:magic-initiate",
    featChoices: { list: ["cleric"] },
    equipment: [
      { id: "A", label: "Calligrapher's supplies, a book of prayers, a holy symbol, parchment, a robe and 8 GP", items: [], gold: 8 },
      coin(50)
    ]
  },
  {
    id: "srd:background:criminal",
    name: "Criminal",
    source: srd52Source("srd-2024_criminal"),
    edition: "2024",
    abilities: ["dex", "con", "int"],
    skills: ["sleight_of_hand", "stealth"],
    feat: "srd:feat:alert",
    equipment: [
      { id: "A", label: "Two daggers, thieves' tools, a crowbar, two pouches, traveler's clothes and 16 GP", items: [{ ref: "srd:weapon:dagger", count: 2 }], gold: 16 },
      coin(50)
    ]
  },
  {
    id: "srd:background:sage",
    name: "Sage",
    source: srd52Source("srd-2024_sage"),
    edition: "2024",
    abilities: ["con", "int", "wis"],
    skills: ["arcana", "history"],
    feat: "srd:feat:magic-initiate",
    featChoices: { list: ["wizard"] },
    equipment: [
      { id: "A", label: "A quarterstaff, calligrapher's supplies, a history book, parchment, a robe and 8 GP", items: [{ ref: "srd:weapon:quarterstaff" }], gold: 8 },
      coin(50)
    ]
  },
  {
    id: "srd:background:soldier",
    name: "Soldier",
    source: srd52Source("srd-2024_soldier"),
    edition: "2024",
    abilities: ["str", "dex", "con"],
    skills: ["athletics", "intimidation"],
    feat: "srd:feat:savage-attacker",
    equipment: [
      { id: "A", label: "A spear, a shortbow and arrows, a gaming set, a healer's kit, traveler's clothes and 14 GP", items: [{ ref: "srd:weapon:spear" }, { ref: "srd:weapon:shortbow" }], gold: 14 },
      coin(50)
    ]
  }
];
