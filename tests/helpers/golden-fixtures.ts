import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAutomatedEncounter, sampleEncounter, type ActionDefinition, type EncounterSnapshot, type Point } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * The fights behind the golden Auto Run logs (`tests/turn-loop-golden.test.ts`): a spread of what Auto Run has to
 * sequence — death saves, reinforcements, summons slotted into the order, splits, regeneration, swallowing, shape
 * changes, legendary and lair actions, auras, reactions and zone spells. Each is built through the store, the way a
 * user builds one, then made reproducible: combatant ids are renamed in order and initiative is cleared, so every
 * seed rolls its own.
 */
export interface GoldenFixture {
  name: string;
  seeds: number;
  build: () => Promise<EncounterSnapshot>;
}

const pristine = useEncounterStore.getState();
const store = () => useEncounterStore.getState();

type Placement = [monsterId: string, faction: "party" | "enemy", position: Point, quantity?: number];

async function buildScene(width: number, height: number, placements: Placement[]): Promise<EncounterSnapshot> {
  useEncounterStore.setState(pristine, true);
  store().updateGrid({ width, height });
  // The sample fighter, archer and goblins are the store's default scene; these fights start from an empty one.
  useEncounterStore.setState({ encounter: { ...store().encounter, combatants: [], definitions: [] } });
  for (const [monsterId, faction, position, quantity] of placements) {
    await store().addSrdMonster(`srd:monster:${monsterId}`, faction, position, quantity ?? 1);
  }
  return canonical(store().encounter);
}

/** Stable ids (the store mints random ones) and no initiative, so each seed rolls the order itself. */
function canonical(encounter: EncounterSnapshot): EncounterSnapshot {
  const snapshot = structuredClone(encounter);
  snapshot.id = "enc-golden";
  snapshot.round = 0;
  snapshot.turnIndex = 0;
  snapshot.combatants = snapshot.combatants.map((combatant, index) => ({
    ...combatant,
    id: `golden-${index + 1}`,
    initiative: undefined
  }));
  return snapshot;
}

const lairEruption: ActionDefinition = {
  kind: "area-save", id: "golden-lair-eruption", name: "Magma Eruption", actionType: "action", saveAbility: "dex", dc: 15,
  range: 120, area: { type: "circle", size: 10 }, targeting: { origin: "point", range: 120 },
  damage: [{ dice: "3d6", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile",
  automationSupport: "full"
};

const lairTremor: ActionDefinition = {
  kind: "save", id: "golden-lair-tremor", name: "Tremor", actionType: "action", saveAbility: "dex", dc: 15, range: 120,
  damage: [], halfDamageOnSuccess: false, riders: [{ id: "golden-lair-tremor-prone", kind: "condition", when: "on-save-fail", condition: "prone", duration: { kind: "until-start-of-next-turn" } }],
  automationSupport: "full"
};

export const GOLDEN_FIXTURES: GoldenFixture[] = [
  {
    name: "sample",
    seeds: 20,
    build: async () => canonical(structuredClone(sampleEncounter))
  },
  {
    name: "casters",
    seeds: 5,
    build: () => buildScene(20, 12, [
      ["knight", "party", { x: 2, y: 5 }],
      ["priest", "party", { x: 2, y: 8 }],
      ["mage", "party", { x: 1, y: 6 }],
      ["veteran", "party", { x: 3, y: 7 }],
      ["mage", "enemy", { x: 17, y: 6 }],
      ["goblin", "enemy", { x: 15, y: 3 }, 2],
      ["ogre", "enemy", { x: 16, y: 9 }],
      ["ghast", "enemy", { x: 14, y: 6 }]
    ])
  },
  {
    name: "monsters",
    seeds: 3,
    build: () => buildScene(20, 14, [
      ["knight", "party", { x: 2, y: 4 }],
      ["veteran", "party", { x: 2, y: 7 }],
      ["gladiator", "party", { x: 3, y: 10 }],
      ["priest", "party", { x: 1, y: 6 }],
      ["troll", "enemy", { x: 16, y: 3 }],
      ["ochre-jelly", "enemy", { x: 15, y: 7 }],
      ["giant-toad", "enemy", { x: 16, y: 10 }],
      ["giant-crab", "enemy", { x: 13, y: 5 }],
      ["wererat", "enemy", { x: 14, y: 11 }],
      ["dust-mephit", "enemy", { x: 17, y: 12 }]
    ])
  },
  {
    name: "legendary",
    seeds: 3,
    build: async () => {
      const encounter = await buildScene(24, 16, [
        ["knight", "party", { x: 2, y: 5 }],
        ["gladiator", "party", { x: 2, y: 9 }],
        ["mage", "party", { x: 1, y: 7 }],
        ["priest", "party", { x: 1, y: 11 }],
        ["veteran", "party", { x: 3, y: 7 }],
        ["adult-red-dragon", "enemy", { x: 18, y: 6 }],
        ["pit-fiend", "enemy", { x: 19, y: 11 }]
      ]);
      // A lair of its own (no SRD monster ships with lair actions), and the dragon fighting in it.
      const dragon = encounter.combatants.find((combatant) => combatant.definitionId === "srd:monster:adult-red-dragon")!;
      const definition = encounter.definitions.find((candidate) => candidate.id === dragon.definitionId)!;
      definition.lairActions = [structuredClone(lairEruption), structuredClone(lairTremor)];
      dragon.inLair = true;
      return encounter;
    }
  },
  {
    name: "reinforcements",
    seeds: 3,
    build: async () => {
      const encounter = await buildScene(18, 12, [
        ["veteran", "party", { x: 2, y: 4 }],
        ["priest", "party", { x: 2, y: 7 }],
        ["scout", "party", { x: 1, y: 9 }],
        ["vrock", "enemy", { x: 14, y: 5 }],
        ["orc", "enemy", { x: 13, y: 8 }, 2],
        ["hobgoblin", "enemy", { x: 16, y: 2 }, 2]
      ]);
      // The vrock may call for help (its optional Summon Demon), and the hobgoblins arrive in round 2.
      const vrock = encounter.definitions.find((candidate) => candidate.id === "srd:monster:vrock")!;
      vrock.traits = (vrock.traits ?? []).map((trait) => (trait.optional ? { ...trait, enabled: true } : trait));
      for (const combatant of encounter.combatants) {
        if (combatant.definitionId === "srd:monster:hobgoblin") {
          combatant.state = "reserve";
          combatant.arrivesRound = 2;
        }
      }
      return encounter;
    }
  }
];

/** Long enough for every fixture to use what it's there for; short enough to keep the test quick. */
export const GOLDEN_MAX_ROUNDS = 20;

/** One run, reduced to what the golden file keeps: a hash of the whole log and outcome, and a few readable facts. */
export function goldenRun(encounter: EncounterSnapshot, seed: string) {
  const result = runAutomatedEncounter({ ...structuredClone(encounter), seed }, GOLDEN_MAX_ROUNDS);
  const body = JSON.stringify({ log: result.log, outcome: result.outcome });
  return {
    record: {
      seed,
      hash: createHash("sha1").update(body).digest("hex"),
      events: result.log.length,
      winner: result.outcome.winner,
      rounds: result.outcome.rounds
    },
    result
  };
}

export function goldenSeed(fixture: string, index: number): string {
  return `golden:${fixture}:${index}`;
}

/** `GOLDEN_DUMP=<dir>` writes each run's log, to diff against a dump made before a change. */
export function dumpRun(directory: string, fixture: string, seed: string, result: ReturnType<typeof goldenRun>["result"]): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${fixture}--${seed.replace(/[^a-z0-9-]/gi, "_")}.json`), JSON.stringify({ outcome: result.outcome, log: result.log }, null, 1));
}
