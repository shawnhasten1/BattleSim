import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectDependencies, createEngineState, findSummonCycle, getDefinition, getExecutableActions, missingDependencies, resolveSummonAction, resolveTransformAction,
  runAutomatedEncounter, sampleEncounter, type CombatantState, type CreatureDefinition, type EncounterSnapshot, type SummonActionDefinition, type TransformActionDefinition
} from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";

/** The generated library: shapechanger forms, Split, the optional summon variants — and their dependencies. */
const chunkDir = fileURLToPath(new URL("../src/data/srd/monsters/generated/chunks/", import.meta.url));
const all = readdirSync(chunkDir).flatMap((file) => (JSON.parse(readFileSync(`${chunkDir}${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions);
const of = (id: string) => all.find((monster) => monster.id === `srd:monster:${id}`)!;
const pristineStore = useEncounterStore.getState();
const store = () => useEncounterStore.getState();
const names = (definition: CreatureDefinition) => getExecutableActions(definition).map((action) => action.name);

describe("shapechanger forms", () => {
  it("splits a werewolf into a browsable humanoid and two hidden forms that each carry the transform", () => {
    const humanoid = of("werewolf");
    const wolf = of("werewolf--wolf");
    const hybrid = of("werewolf--hybrid");
    expect(humanoid.hidden).toBeUndefined();
    expect([wolf.hidden, hybrid.hidden]).toEqual([true, true]);
    expect([wolf.formOf, hybrid.formOf]).toEqual([humanoid.id, humanoid.id]);
    for (const form of [humanoid, wolf, hybrid]) {
      const transform = form.actions.find((action): action is TransformActionDefinition => action.kind === "transform")!;
      expect(transform.forms.map((entry) => entry.definitionId).sort(), form.id).toEqual([hybrid.id, wolf.id].sort());
      expect(transform.canRevert && transform.revertOnDeath).toBe(true);
    }
  });

  it("gives each shape only its own attacks", () => {
    expect(names(of("werewolf")).some((name) => name.startsWith("Spear"))).toBe(true);
    expect(names(of("werewolf"))).not.toContain("Bite");
    expect(names(of("werewolf--wolf"))).toContain("Bite");
    expect(names(of("werewolf--wolf"))).not.toEqual(expect.arrayContaining(["Claws"]));
    expect(names(of("werewolf--hybrid"))).toEqual(expect.arrayContaining(["Bite", "Claws"]));
    expect(names(of("werewolf--hybrid")).some((name) => name.startsWith("Spear"))).toBe(false);
  });

  it("a lycanthrope starts in hybrid form; a vampire in its own", () => {
    expect(of("werewolf").defaultActiveForm).toBe("srd:monster:werewolf--hybrid");
    for (const slug of ["wererat", "werebear", "wereboar", "weretiger"]) expect(of(slug).defaultActiveForm, slug).toBe(`srd:monster:${slug}--hybrid`);
    expect(of("vampire").defaultActiveForm).toBeUndefined();
    expect(of("vampire--bat").hidden).toBe(true);
    expect(names(of("vampire--bat"))).toContain("Bite");
    expect(names(of("vampire"))).toEqual(expect.arrayContaining(["Unarmed Strike"]));
  });

  it("no hidden form references an attack it doesn't have", () => {
    for (const form of all.filter((monster) => monster.hidden)) {
      const ids = new Set(getExecutableActions(form).map((action) => action.id));
      for (const action of form.actions) if (action.kind === "multiattack") for (const step of [...action.attacks, ...(action.options ?? []).flatMap((option) => option.attacks)]) if (step.actionId) expect(ids.has(step.actionId), `${form.id} ${step.actionId}`).toBe(true);
      for (const ref of form.legendary?.actions ?? []) if (ref.actionId) expect(ids.has(ref.actionId), `${form.id} legendary ${ref.name}`).toBe(true);
    }
  });

  it("only the fixed-shape creatures are split: a doppelganger, oni or dragon is left alone", () => {
    expect(all.filter((monster) => monster.hidden).map((monster) => monster.id).sort()).toEqual([
      "srd:monster:vampire--bat", "srd:monster:werebear--bear", "srd:monster:werebear--hybrid", "srd:monster:wereboar--boar", "srd:monster:wereboar--hybrid",
      "srd:monster:wererat--hybrid", "srd:monster:wererat--rat", "srd:monster:weretiger--hybrid", "srd:monster:weretiger--tiger",
      "srd:monster:werewolf--hybrid", "srd:monster:werewolf--wolf"
    ]);
  });
});

describe("Split", () => {
  it("black pudding and ochre jelly split on lightning or slashing, at 10 HP or more", () => {
    for (const slug of ["black-pudding", "ochre-jelly"]) {
      const effect = of(slug).traits?.flatMap((trait) => trait.effects ?? []).find((entry) => entry.kind === "split-on-damage");
      expect(effect, slug).toEqual({ kind: "split-on-damage", triggerDamageTypes: ["lightning", "slashing"], minHp: 10 });
      expect(of(slug).reactions ?? []).toEqual([]);
    }
  });
});

describe("optional summon variants", () => {
  const summonOf = (slug: string) => of(slug).traits!.flatMap((trait) => trait.grantedActions ?? []).find((action): action is SummonActionDefinition => action.kind === "summon")!;

  it("a hezrou's Summon Demon: 30%, 2d6 dretches or another hezrou, not below a generation, once", () => {
    const action = summonOf("hezrou");
    expect(action).toMatchObject({ chance: 30, choice: "pick", durationRounds: 10, maxGeneration: 1, range: 60 });
    expect(action.options.map((option) => [option.definitionId, option.count])).toEqual([["srd:monster:dretch", { dice: "2d6" }], ["srd:monster:hezrou", 1]]);
    expect(action.usage).toEqual({ kind: "uses", uses: 1 });
  });

  it("a balor's option list drops the goristro (not in the SRD) and says so", () => {
    expect(summonOf("balor").options.map((option) => option.id)).toEqual(["vrock", "hezrou", "glabrezu", "nalfeshnee", "marilith"]);
    expect(summonOf("balor").options.map((option) => option.count)).toEqual([{ dice: "1d8" }, { dice: "1d6" }, { dice: "1d4" }, { dice: "1d3" }, { dice: "1d2" }]);
  });

  it("a mephit summons its own kind, 25%", () => {
    expect(summonOf("dust-mephit")).toMatchObject({ chance: 25, options: [{ definitionId: "srd:monster:dust-mephit", count: { dice: "1d4" } }] });
  });

  it("is off until switched on, and the variant feature is flagged optional", () => {
    const hezrou = of("hezrou");
    expect(names(hezrou)).not.toContain("Summon Demon");
    const feature = hezrou.traits!.find((trait) => trait.optional && trait.grantedActions?.length)!;
    expect(names({ ...hezrou, traits: hezrou.traits!.map((trait) => (trait === feature ? { ...trait, enabled: true } : trait)) })).toContain("Summon Demon");
  });
});

describe("dependencies", () => {
  it("collects what a creature summons and changes into, even for a variant that's switched off", () => {
    expect(collectDependencies(of("hezrou")).sort()).toEqual(["srd:monster:dretch"]);
    expect(collectDependencies(of("werewolf")).sort()).toEqual(["srd:monster:werewolf--hybrid", "srd:monster:werewolf--wolf"]);
    expect(collectDependencies(of("goblin"))).toEqual([]);
  });

  it("reports what an encounter is missing", () => {
    expect(missingDependencies({ definitions: [of("werewolf")] }).sort()).toEqual(["srd:monster:werewolf--hybrid", "srd:monster:werewolf--wolf"]);
    expect(missingDependencies({ definitions: [of("werewolf"), of("werewolf--wolf"), of("werewolf--hybrid")] })).toEqual([]);
  });

  it("spots a summon loop between two creatures, but not a shapechanger's forms", () => {
    const summons = (id: string, target: string): CreatureDefinition => ({
      ...of("goblin"), id, actions: [{ kind: "summon", id: "s", name: "S", actionType: "action", range: 30, options: [{ id: "o", definitionId: target, label: "x", count: 1 }], choice: "pick", automationSupport: "full" }]
    });
    expect(findSummonCycle([summons("a", "b"), summons("b", "a")], "a")).toEqual(["a", "b", "a"]);
    expect(findSummonCycle([summons("a", "b"), of("goblin")], "a")).toBeUndefined();
    expect(findSummonCycle([of("werewolf"), of("werewolf--wolf"), of("werewolf--hybrid")], of("werewolf").id)).toBeUndefined();
  });
});

describe("through the store", () => {
  it("placing a werewolf brings its forms and starts it as a hybrid", async () => {
    await store().addSrdMonster("srd:monster:werewolf", "enemy", { x: 3, y: 3 });
    const ids = store().encounter.definitions.map((definition) => definition.id);
    expect(ids).toEqual(expect.arrayContaining(["srd:monster:werewolf", "srd:monster:werewolf--hybrid", "srd:monster:werewolf--wolf"]));
    const token = store().encounter.combatants.find((combatant) => combatant.definitionId === "srd:monster:werewolf")!;
    expect(token.activeForm).toEqual({ definitionId: "srd:monster:werewolf--hybrid" });
    expect(missingDependencies(store().encounter)).toEqual([]);
    expect(names(getDefinition(store().encounter, token))).toContain("Claws");
  });

  it("placing a hezrou brings the dretches its variant could summon", async () => {
    await store().addSrdMonster("srd:monster:hezrou", "enemy", { x: 6, y: 3 });
    expect(store().encounter.definitions.some((definition) => definition.id === "srd:monster:dretch")).toBe(true);
  });
});

describe("in a fight", () => {
  it("a hezrou with its variant on summons dretches, and the fight finishes", async () => {
    // Only its summon to do, so the AI has to weigh it against nothing else.
    const hezrou = { ...of("hezrou"), actions: of("hezrou").actions.filter((action) => action.kind !== "attack" && action.kind !== "multiattack") };
    hezrou.traits = hezrou.traits!.map((trait) => (trait.optional ? { ...trait, enabled: true } : trait));
    const base = structuredClone(sampleEncounter);
    const fighter = { ...base.definitions.find((definition) => definition.id === "def-fighter")!, maxHp: 400, armorClass: 12 };
    const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number): CombatantState => ({
      id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: definition.maxHp, tempHp: 0,
      state: "active", tacticsProfile: "basic-melee", resourceStance: "liberal", resources: definition.resources ? { ...definition.resources } : undefined
    });
    const scene: EncounterSnapshot = {
      ...base, seed: "demons", map: { ...base.map, grid: { ...base.map.grid, width: 24, height: 12 }, walls: [], terrain: [] },
      definitions: [hezrou, of("dretch"), fighter], combatants: [token("hezrou", hezrou, "enemy", 5), token("hero", fighter, "party", 12)]
    };
    // Try a few seeds: the summon has a 30% chance to work.
    let spawned = 0;
    for (const seed of ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8"]) {
      const result = runAutomatedEncounter({ ...scene, seed }, 12);
      expect(result.log.filter((entry) => entry.type === "AutomationWarning" && /failed/.test(entry.message))).toEqual([]);
      spawned += result.log.filter((entry) => entry.type === "CombatantSpawned" && (entry.data?.combatants as unknown[] | undefined)?.length).length;
    }
    expect(spawned).toBeGreaterThan(0);
  });

  it("a werewolf changes shape on command in a real encounter", async () => {
    await store().addSrdMonster("srd:monster:vampire", "enemy", { x: 8, y: 3 });
    const engine = createEngineState(store().encounter);
    const vampire = engine.snapshot.combatants.find((combatant) => combatant.definitionId === "srd:monster:vampire")!;
    resolveTransformAction(engine, vampire.id, "shapechanger", "bat");
    expect(getDefinition(engine.snapshot, vampire).id).toBe("srd:monster:vampire--bat");
  });

  it("the summon action refuses to run without its creature embedded", () => {
    const engine = createEngineState({
      ...structuredClone(sampleEncounter),
      definitions: [{ ...of("hezrou"), traits: of("hezrou").traits!.map((trait) => (trait.optional ? { ...trait, enabled: true } : trait)) }],
      combatants: [{ id: "h", definitionId: "srd:monster:hezrou", displayName: "H", faction: "enemy", position: { x: 2, y: 2 }, currentHp: 100, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced", resources: { "usage:summon": 1 } } as CombatantState]
    });
    const action = getExecutableActions(engine.snapshot.definitions[0]!).find((candidate) => candidate.kind === "summon")!;
    for (const seed of ["x1", "x2", "x3", "x4", "x5", "x6"]) {
      const trial = createEngineState({ ...engine.snapshot, seed });
      try {
        resolveSummonAction(trial, "h", action.id, "dretch");
      } catch (error) {
        expect(String(error)).toMatch(/isn't embedded|embedded in this encounter/);
        return;
      }
    }
  });
});

describe("normalizing keeps the structured records", () => {
  it("summon and transform actions, and hold / swallow riders, survive an import round-trip", async () => {
    const { normalizeActionDefinition } = await import("@/engine");
    const summon = normalizeActionDefinition(JSON.parse(JSON.stringify(of("hezrou").traits!.flatMap((trait) => trait.grantedActions ?? [])[0])));
    expect(summon.kind).toBe("summon");
    expect((summon as SummonActionDefinition).options).toHaveLength(2);
    const transform = normalizeActionDefinition(JSON.parse(JSON.stringify(of("werewolf").actions.find((action) => action.kind === "transform"))));
    expect(transform.kind).toBe("transform");

    const croc = normalizeActionDefinition(JSON.parse(JSON.stringify(of("crocodile").actions.find((action) => action.kind === "attack" && action.riders?.some((rider) => rider.kind === "hold")))));
    expect(croc.kind === "attack" && croc.riders?.some((rider) => rider.kind === "hold")).toBe(true);
    const bite = normalizeActionDefinition(JSON.parse(JSON.stringify(of("purple-worm").actions.find((action) => action.kind === "attack" && action.riders?.some((rider) => rider.kind === "swallow")))));
    expect(bite.kind === "attack" && bite.riders?.some((rider) => rider.kind === "swallow")).toBe(true);
  });
});

describe("Auto Run and Step agree on spawned combatants", () => {
  it("a werewolf, an ochre jelly and a knight finish in both modes with no lost turns", async () => {
    const pristine = pristineStore;
    useEncounterStore.setState(pristine, true);
    const s = () => useEncounterStore.getState();
    s().updateGrid({ width: 20, height: 12 });
    await s().addSrdMonster("srd:monster:knight", "party", { x: 2, y: 5 }, 2);
    await s().addSrdMonster("srd:monster:werewolf", "enemy", { x: 12, y: 3 });
    await s().addSrdMonster("srd:monster:ochre-jelly", "enemy", { x: 12, y: 8 });
    const start = structuredClone(s().encounter);
    const auto = runAutomatedEncounter(start, 40);
    useEncounterStore.setState({ ...pristine, encounter: structuredClone(start), log: [], outcome: null, replayBase: null, replayIndex: null }, true);
    s().rollInitiativeNow();
    let steps = 0;
    while (s().outcome === null && steps < 1500) {
      s().advanceTurn();
      steps += 1;
    }
    for (const [mode, log] of [["auto", auto.log], ["step", s().log]] as const) {
      expect(log.filter((entry) => entry.type === "AutomationWarning" && /failed/.test(entry.message)), mode).toEqual([]);
    }
    expect(s().outcome, `still going after ${steps} steps`).not.toBeNull();
    // The jelly splits when a knight's longsword slashes it, in both modes.
    expect(auto.log.some((entry) => entry.type === "CombatantSplit")).toBe(true);
    expect(s().log.some((entry) => entry.type === "CombatantSplit")).toBe(true);
  }, 120_000);
});
