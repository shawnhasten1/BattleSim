import { describe, expect, it } from "vitest";
import { loadSrdMonster } from "@/data/srd/monsters";
import { blankCharacter, QUICK_PARTY_CLASSES, quickParty, rebuildActor } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { runBatchSimulations, sampleEncounter, type CombatantState, type CreatureDefinition, type EncounterSnapshot } from "@/engine";

/**
 * PC builder plan, Phase 9d: the batch sanity check. The Quick party at 5th level (Fighter, Cleric, Rogue, Wizard)
 * against an SRD fight of Moderate difficulty for it (a Hill Giant and two Ogres: 2,700 XP against a 3,000 XP budget),
 * on an open floor, 100 seeds. It checks a broad range, not a pass mark: a party that loses most of these, or a member
 * who does nothing, means a number is wrong somewhere. (A Troll in the giant's place takes the party to a coin flip:
 * it gets back up unless fire or acid hits it, and only the Wizard has fire. That's the Troll, not the builds.)
 */

const token = (definition: CreatureDefinition, faction: "party" | "enemy", x: number, y: number, name: string): CombatantState => ({
  id: `${faction}-${name.toLowerCase().replace(/\s+/g, "-")}`,
  definitionId: definition.id,
  displayName: name,
  faction,
  position: { x, y },
  currentHp: definition.maxHp,
  tempHp: 0,
  resources: { ...(definition.resources ?? {}) },
  state: "active",
  resourceStance: "balanced"
} as CombatantState);

async function encounter(): Promise<EncounterSnapshot> {
  const party = quickParty(SRD_BUILD_SOURCES, QUICK_PARTY_CLASSES, 5)
    .map((member, index) => rebuildActor(blankCharacter(`pc-${index + 1}`, member.name), member.build, SRD_BUILD_SOURCES).definition);
  const giant = (await loadSrdMonster("srd:monster:hill-giant"))!;
  const ogre = (await loadSrdMonster("srd:monster:ogre"))!;
  const snapshot = structuredClone(sampleEncounter);
  // An open floor: no walls or terrain to hide behind.
  const squarePx = snapshot.map.canvas!.widthPx / snapshot.map.grid.width;
  snapshot.map = {
    ...snapshot.map, walls: [], terrain: [],
    grid: { ...snapshot.map.grid, width: 24, height: 16 },
    canvas: { ...snapshot.map.canvas!, widthPx: 24 * squarePx, heightPx: 16 * squarePx }
  };
  snapshot.definitions = [...party, giant, ogre];
  // The party in a line on the left, the giants 50 ft away.
  snapshot.combatants = [
    ...party.map((definition, index) => token(definition, "party", 3, 4 + index * 2, definition.name)),
    token(giant, "enemy", 13, 7, "Hill Giant"),
    token(ogre, "enemy", 14, 4, "Ogre 1"),
    token(ogre, "enemy", 14, 10, "Ogre 2")
  ];
  return snapshot;
}

describe("the batch sanity check", () => {
  it("a 5th-level Quick party wins a Moderate SRD fight nearly always, every member pulling its weight", { timeout: 300000 }, async () => {
    const summary = runBatchSimulations(await encounter(), 100, { seedPrefix: "pc-builder-sanity", maxRounds: 30 });
    console.log(`party wins ${Math.round(summary.partyWinRate * 100)}%, deaths ${Math.round(summary.characterDeathRate * 100)}%, TPK ${Math.round(summary.tpkRate * 100)}%, rounds ${summary.rounds.average.toFixed(1)} (${summary.rounds.min}-${summary.rounds.max}), ${summary.difficultyLabel}`);
    expect(summary.runCount).toBe(100);
    expect(summary.partyWinRate).toBeGreaterThan(0.6);
    expect(summary.tpkRate).toBeLessThan(0.25);
    expect(summary.rounds.average).toBeGreaterThan(2);
    expect(summary.rounds.average).toBeLessThan(10);
    // Each one deals damage (the Cleric mostly heals, but swings too); the giants are hurt by the party, not by luck.
    for (const metric of summary.damageByCombatant.filter((entry) => entry.faction === "party")) expect(metric.damageDealt, metric.displayName).toBeGreaterThan(1);
  });
});
