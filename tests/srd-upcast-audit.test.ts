import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEngineState, getExecutableActions, resolveAreaSaveAction, resolveBuffAction, sampleEncounter, targetCapacity } from "@/engine";
import type { ActionDefinition, CreatureDefinition, RandomSource, SpellDefinition, SpellUpcast } from "@/engine";
import { findSrdSpell, SRD_SPELLS } from "@/data/srd";

/**
 * Every library spell whose "At Higher Levels" text (srd_2014_spells_full.csv) makes a higher slot do more says what:
 * as data the engine runs (`upcast.perSlotAboveBase`), or as a note that it isn't modelled (`upcast.notModelled`). A
 * counter's higher slot is its rule (it stops spells up to that level), so Counterspell needs neither.
 */

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === "\"" && text[index + 1] === "\"") { field += "\""; index += 1; } else if (char === "\"") quoted = false; else field += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const rows = parseCsv(readFileSync(join(__dirname, "..", "srd_2014_spells_full.csv"), "utf8").replace(/^﻿/, ""));
const header = rows[0]!;
const higherLevel = new Map(rows.slice(1).map((row) => [row[header.indexOf("name")]!.toLowerCase(), row[header.indexOf("higher_level")] ?? ""]));

/** "Melf's Acid Arrow" is "Acid Arrow" in the SRD. */
const csvText = (spell: SpellDefinition) => higherLevel.get(spell.name.toLowerCase()) ?? higherLevel.get(spell.name.toLowerCase().replace(/^[a-z]+'s /, ""));
const upcastOf = (spell: SpellDefinition): SpellUpcast | undefined => (spell.action as { upcast?: SpellUpcast } | undefined)?.upcast ?? spell.upcast;
const isCounter = (spell: SpellDefinition) => (spell.action as { reaction?: { trigger: { kind: string } } } | undefined)?.reaction?.trigger.kind === "enemy-casts-spell";

describe("the spell library's upcasting", () => {
  const leveled = SRD_SPELLS.filter((spell) => spell.level > 0);

  it("finds every leveled spell in the SRD's spell list", () => {
    expect(leveled.filter((spell) => csvText(spell) === undefined).map((spell) => spell.name)).toEqual([]);
  });

  it("says what a higher slot does for every spell whose text says it does something", () => {
    const silent = leveled.filter((spell) => csvText(spell)?.trim() && !isCounter(spell)
      && !Object.keys(upcastOf(spell)?.perSlotAboveBase ?? {}).length && !upcastOf(spell)?.notModelled);
    expect(silent.map((spell) => spell.name)).toEqual([]);
  });

  it("has no upcasting for a spell whose text has nothing at higher levels", () => {
    const invented = leveled.filter((spell) => !csvText(spell)?.trim() && upcastOf(spell));
    expect(invented.map((spell) => spell.name)).toEqual([]);
  });
});

/** d20s all 1 (every save fails), and every other die its lowest. */
const lowRolls: RandomSource = { next: () => 0, nextInt: (min: number) => min, fork: () => lowRolls };

function withSpell(id: string, slots: Record<string, number>) {
  const encounter = structuredClone(sampleEncounter);
  encounter.map.walls = [];
  encounter.map.terrain = [];
  const definition = encounter.definitions.find((candidate) => candidate.id === "def-fighter")!;
  definition.actions = [];
  definition.spells = [structuredClone(findSrdSpell(id) as SpellDefinition)];
  definition.resources = slots;
  encounter.combatants.find((candidate) => candidate.id === "pc-fighter")!.resources = { ...slots };
  return { encounter, definition: definition as CreatureDefinition };
}

describe("the library's new upcasting, in play", () => {
  it("Bless with a 2nd-level slot blesses four", () => {
    const { encounter, definition } = withSpell("srd:spell:bless", { "slot-1": 1, "slot-2": 1 });
    const upcast = getExecutableActions(definition).find((action) => action.id === "srd:spell:bless:action:upcast-2")!;
    expect(targetCapacity(upcast, 5)).toBe(4);
    expect(targetCapacity(getExecutableActions(definition).find((action) => action.id === "srd:spell:bless:action")!, 5)).toBe(3);
    const fighter = encounter.combatants.find((candidate) => candidate.id === "pc-fighter")!;
    encounter.combatants = [...encounter.combatants, ...[1, 2, 3].map((n) => ({ ...structuredClone(fighter), id: `ally-${n}`, position: { x: fighter.position.x + n, y: fighter.position.y } }))];
    const state = createEngineState(encounter);
    const result = resolveBuffAction(state, "pc-fighter", upcast.id, ["pc-fighter", "ally-1", "ally-2", "ally-3"]);
    expect(result.targetIds).toHaveLength(4);
  });

  it("Ice Storm with a 5th-level slot adds a d8 of bludgeoning", () => {
    const { encounter } = withSpell("srd:spell:ice-storm", { "slot-4": 1, "slot-5": 1 });
    const goblin = encounter.combatants.find((candidate) => candidate.id === "enemy-goblin-1")!;
    goblin.currentHp = 100;
    encounter.definitions.find((candidate) => candidate.id === "def-goblin")!.maxHp = 100;
    const damageFrom = (actionId: string) => {
      const state = createEngineState(structuredClone(encounter));
      state.rng = lowRolls;
      resolveAreaSaveAction(state, "pc-fighter", goblin.position, actionId);
      return 100 - state.snapshot.combatants.find((candidate) => candidate.id === goblin.id)!.currentHp;
    };
    // Every die rolls 1: 2d8 + 4d6 is 6 at 4th level, and the 5th-level slot's extra d8 makes it 7.
    expect(damageFrom("srd:spell:ice-storm:action")).toBe(6);
    expect(damageFrom("srd:spell:ice-storm:action:upcast-5")).toBe(7);
  });

  it("a spell whose higher slot isn't modelled still casts with one, doing the same", () => {
    const { definition } = withSpell("srd:spell:confusion", { "slot-4": 1, "slot-5": 1 });
    const copies = getExecutableActions(definition).filter((action: ActionDefinition) => action.id.startsWith("srd:spell:confusion:action"));
    expect(copies.map((action) => action.id)).toEqual(["srd:spell:confusion:action", "srd:spell:confusion:action:upcast-5"]);
  });
});
