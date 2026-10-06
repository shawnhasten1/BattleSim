"use client";

import { useCallback } from "react";
import { spellcastingAbility, type CreatureDefinition } from "@/engine";
import type { SrdEntryKind } from "@/data/srd";
import type { Prepared } from "@/lib/ability-editor/add";
import { blankLegendaryAction } from "@/lib/ability-editor/legendary";
import { blankMultiattack } from "@/lib/ability-editor/sequence";
import {
  blankAttack,
  blankDeathEffect,
  blankFeature,
  blankItem,
  blankLairAction,
  blankReaction,
  blankSpecialAction,
  blankSpell,
  blankSummon,
  blankTransform,
  blankWeapon
} from "@/lib/ability-editor/templates";
import { useEncounterStore } from "@/store/encounter-store";
import type { SheetEditorTarget } from "../ability-editor/AbilityEditor";
import type { BlankKind } from "./AddAbility";

/*
 * What Add ability's three ways in do, for every sheet that offers it (Standard's Abilities tab and the Codex): a ready
 * copy or a blank opens in the ability editor, and nothing is added until Save; a library row's "+" adds it at once.
 */

/** A prepared copy (a recipe, or a library or monster entry opened to check first): the editor on it. */
export function preparedTarget(prepared: Prepared): SheetEditorTarget {
  return { mode: "new", list: prepared.list, record: prepared.record, focus: prepared.focus, pools: prepared.pools };
}

/** "Start from scratch": the editor on a blank record of that kind. */
export function blankTarget(kind: BlankKind, definition: CreatureDefinition): SheetEditorTarget {
  switch (kind) {
    case "weapon": return { mode: "new", list: "weapons", record: blankWeapon() };
    case "attack": return { mode: "new", list: "actions", record: blankAttack() };
    case "special": return { mode: "new", list: "actions", record: blankSpecialAction() };
    case "multiattack": return { mode: "new", list: "actions", record: blankMultiattack(definition) };
    case "spell": return { mode: "new", list: "spells", record: blankSpell(spellcastingAbility(definition)) };
    case "feature": return { mode: "new", list: "features", record: blankFeature() };
    case "item": return { mode: "new", list: "items", record: blankItem() };
    case "reaction": return { mode: "new", list: "reactions", record: blankReaction() };
    case "legendary": return { mode: "new", list: "legendary", record: blankLegendaryAction(definition) };
    case "lair": return { mode: "new", list: "lairActions", record: blankLairAction() };
    case "death": return { mode: "new", list: "deathEffects", record: blankDeathEffect() };
    case "summon": return { mode: "new", list: "actions", record: blankSummon() };
    case "transform": return { mode: "new", list: "actions", record: blankTransform() };
  }
}

/** A library row's "+": the weapon, spell, item or feature added to the creature as it is. */
export function useAttachFromLibrary(definitionId: string): (kind: SrdEntryKind, id: string) => void {
  const attachSrdWeapon = useEncounterStore((s) => s.attachSrdWeapon);
  const attachSrdSpell = useEncounterStore((s) => s.attachSrdSpell);
  const attachSrdFeature = useEncounterStore((s) => s.attachSrdFeature);
  const attachSrdItem = useEncounterStore((s) => s.attachSrdItem);
  return useCallback((kind: SrdEntryKind, id: string) => {
    if (kind === "weapon") attachSrdWeapon(definitionId, id);
    else if (kind === "spell") attachSrdSpell(definitionId, id);
    else if (kind === "item") attachSrdItem(definitionId, id);
    else attachSrdFeature(definitionId, id);
  }, [attachSrdFeature, attachSrdItem, attachSrdSpell, attachSrdWeapon, definitionId]);
}
