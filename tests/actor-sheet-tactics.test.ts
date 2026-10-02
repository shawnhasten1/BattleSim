import { beforeEach, describe, expect, it } from "vitest";
import { sampleEncounter } from "@/engine";
import { SRD_MONSTER_INDEX, loadSrdMonster } from "@/data/srd/monsters";
import { abilityList } from "@/lib/ability-editor/list";
import { aiUses } from "@/lib/actor-sheet/ai-uses";
import { defaultTacticsOf } from "@/lib/actor-sheet/token";
import { useEncounterStore } from "@/store/encounter-store";

/** The actor sheet plan's Phase 5: a creature's default tactics, Use these for every Knight, and What the AI will use. */

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));

const store = () => useEncounterStore.getState();
const token = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!;
const creature = (id: string) => store().encounter.definitions.find((definition) => definition.id === id)!;
const names = (uses: ReturnType<typeof aiUses>["simulated"]) => uses.map(({ row, how }) => (how ? `${row.name} (${how})` : row.name));

describe("a creature's default tactics", () => {
  it("are its own, or Basic ranged with a ranged or spell attack it runs, and Basic melee without", async () => {
    expect(defaultTacticsOf((await loadSrdMonster("srd:monster:knight"))!)).toBe("defender");
    const fixture = (id: string) => sampleEncounter.definitions.find((definition) => definition.id === id)!;
    expect(defaultTacticsOf(fixture("def-goblin"))).toBe("basic-ranged");
    expect(defaultTacticsOf(fixture("def-fighter"))).toBe("basic-melee");
  });

  it("Use these for every Goblin: the default, and every goblin in the scene, as one undo step", () => {
    const undoDepth = store().undoStack.length;
    store().setCreatureBehavior("def-goblin", { tactics: "skirmisher", stance: "liberal" });
    expect([creature("def-goblin").defaultTactics, creature("def-goblin").defaultResourceStance]).toEqual(["skirmisher", "liberal"]);
    for (const id of ["enemy-goblin-1", "enemy-goblin-2"]) expect([token(id).tacticsProfile, token(id).resourceStance]).toEqual(["skirmisher", "liberal"]);
    expect([token("pc-fighter").tacticsProfile, token("pc-fighter").resourceStance]).toEqual(["basic-melee", "balanced"]);
    expect(store().undoStack).toHaveLength(undoDepth + 1);

    // Balanced is the default spending, so it's stored as none.
    store().setCreatureBehavior("def-goblin", { tactics: "brute", stance: "balanced" });
    expect("defaultResourceStance" in creature("def-goblin")).toBe(false);

    // A goblin added afterwards starts with it.
    store().addCreatureDefinition(creature("def-goblin"), "enemy");
    const added = store().encounter.combatants.at(-1)!;
    expect([added.definitionId, added.tacticsProfile, added.resourceStance]).toEqual(["def-goblin", "brute", "balanced"]);

    store().undo();
    store().undo();
    store().undo();
    expect(creature("def-goblin").defaultTactics).toBeUndefined();
    expect([token("enemy-goblin-1").tacticsProfile, token("enemy-goblin-2").tacticsProfile]).toEqual(["basic-ranged", "basic-melee"]);
  });

  it("a batch after the change plays differently, and undoing it plays the batch from before again", () => {
    store().runBatch(16);
    const before = store().batchSummary!.runs;
    store().setCreatureBehavior("def-goblin", { tactics: "brute", stance: "liberal" });
    store().runBatch(16);
    const after = store().batchSummary!.runs;
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
    store().undo();
    store().runBatch(16);
    expect(JSON.stringify(store().batchSummary!.runs)).toBe(JSON.stringify(before));
  }, 60000);
});

describe("What the AI will use", () => {
  it("reads the Knight as its statblock's dots do", async () => {
    const uses = aiUses((await loadSrdMonster("srd:monster:knight"))!);
    expect(names(uses.simulated)).toEqual(["Brave", "Multiattack", "Greatsword", "Heavy Crossbow", "Parry (reaction)"]);
    expect(names(uses.reference)).toEqual(["Leadership"]);
    expect([uses.partly, uses.off]).toEqual([[], []]);
  });

  it("puts every ability of every SRD monster where its Abilities dot does, an optional rule that's off apart", async () => {
    for (const entry of SRD_MONSTER_INDEX) {
      const monster = (await loadSrdMonster(entry.id))!;
      const rows = abilityList(monster).flatMap((group) => [...group.rows, ...(group.levels ?? []).flatMap((level) => level.rows)])
        .filter((row) => row.automation !== "no-effect");
      const uses = aiUses(monster);
      const byKey = (list: Array<{ row: { key: string } }>) => list.map(({ row }) => row.key).sort();
      expect(byKey(uses.simulated), monster.name).toEqual(rows.filter((row) => row.automation === "simulated" && row.enabled !== false).map((row) => row.key).sort());
      expect(byKey(uses.partly), monster.name).toEqual(rows.filter((row) => row.automation === "partial" && row.enabled !== false).map((row) => row.key).sort());
      expect(byKey(uses.reference), monster.name).toEqual(rows.filter((row) => row.automation === "reference" && row.enabled !== false).map((row) => row.key).sort());
      expect(byKey(uses.off), monster.name).toEqual(rows.filter((row) => row.enabled === false).map((row) => row.key).sort());
    }
  }, 120000);
});
