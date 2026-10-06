import { describe, expect, it } from "vitest";
import { SRD_2024_CATALOG } from "@/data/srd/2024";
import { CLASS_COVERAGE, FEAT_COVERAGE, type CoverageEntry } from "@/data/srd/2024/coverage";
import { SRD_2024_REFERENCE } from "@/data/srd/2024/reference";
import {
  backgroundDefinitionSchema,
  blankCharacter,
  buildCharacter,
  classDefinitionSchema,
  featDefinitionSchema,
  quickBuild,
  readBuild,
  rebuildActor,
  speciesDefinitionSchema,
  subclassDefinitionSchema,
  withLevelUp,
  withSuggestions,
  type ChoiceSpec,
  type FeatureGrant
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES, SRD_BUILDER_LIBRARY } from "@/lib/character-builder/srd";
import { creatureDefinitionSchema, sampleEncounter, type FeatureDefinition } from "@/engine";
import { runAutomatedEncounter } from "@/engine/turns";

const PREFIX = "srd-2024_";
const bare = (key: string) => key.slice(PREFIX.length);

/** A grant's feature agrees with the audit's verdict for it. */
function agrees(feature: FeatureDefinition, verdict: CoverageEntry["verdict"]): boolean {
  switch (verdict) {
    case "full": return feature.automationSupport === "full" && !feature.informational;
    case "partial": return feature.automationSupport === "partial" && !feature.informational;
    case "manual": return feature.automationSupport === "manual-only" && !feature.informational;
    case "info": return Boolean(feature.informational);
    case "builder": return true;
  }
}

describe("the 2024 catalog", () => {
  it("passes its own schemas, each entry coming back exactly as it went in (a homebrew one is read the same way)", () => {
    const roundTrips = (schema: { parse(value: unknown): unknown }, entries: Array<{ id: string }>) => {
      for (const entry of entries) {
        const json = JSON.parse(JSON.stringify(entry));
        expect(schema.parse(json), entry.id).toEqual(json);
      }
    };
    roundTrips(classDefinitionSchema, SRD_2024_CATALOG.classes);
    roundTrips(subclassDefinitionSchema, SRD_2024_CATALOG.subclasses);
    roundTrips(featDefinitionSchema, SRD_2024_CATALOG.feats);
    roundTrips(backgroundDefinitionSchema, SRD_2024_CATALOG.backgrounds);
    roundTrips(speciesDefinitionSchema, SRD_2024_CATALOG.species);
  });

  it("has all 17 feats and all four backgrounds, each pointing at a feat that exists", () => {
    expect(SRD_2024_CATALOG.feats.map((feat) => feat.id.replace("srd:feat:", "")).sort())
      .toEqual(SRD_2024_REFERENCE.feats.map((feat) => bare(feat.key)).sort());
    for (const background of SRD_2024_CATALOG.backgrounds) {
      expect(SRD_2024_CATALOG.feats.some((feat) => feat.id === background.feat), background.id).toBe(true);
    }
  });

  it("covers every SRD feature of each class it has, with a grant or a choice", () => {
    for (const definition of SRD_2024_CATALOG.classes) {
      const slug = definition.id.replace("srd:class:", "");
      const subclasses = SRD_2024_CATALOG.subclasses.filter((entry) => entry.classId === definition.id);
      const refs = new Set<string>();
      const take = (grants: FeatureGrant[] = [], choices: ChoiceSpec[] = []) => {
        for (const grant of grants) if (grant.ref) refs.add(grant.ref);
        for (const choice of choices) if (choice.ref) refs.add(choice.ref);
      };
      for (const level of definition.levels) take(level.grants, level.choices);
      for (const subclass of subclasses) for (const level of subclass.levels) take(level.grants, level.choices);
      // The feat levels and the Epic Boon are choices the builder makes from `featLevels`.
      refs.add(`${PREFIX}${slug}_ability-score-improvement`);
      refs.add(`${PREFIX}${slug}_epic-boon`);
      const owners = SRD_2024_REFERENCE.classes.filter((entry) => entry.key === `${PREFIX}${slug}` || entry.subclassOf === `${PREFIX}${slug}`);
      const missing = owners.flatMap((owner) => owner.features)
        .filter((feature) => feature.kind !== "spell-list" && !refs.has(feature.key))
        .map((feature) => feature.key);
      expect(missing, definition.id).toEqual([]);
      for (const ref of refs) expect(owners.some((owner) => owner.features.some((feature) => feature.key === ref)), `${definition.id} ${ref}`).toBe(true);
    }
  });

  it("marks each feature as the coverage audit says", () => {
    const wrong: string[] = [];
    for (const owner of [...SRD_2024_CATALOG.classes, ...SRD_2024_CATALOG.subclasses]) {
      for (const level of owner.levels) {
        for (const grant of level.grants) {
          if (!grant.ref || typeof grant.feature !== "object") continue;
          const audit = CLASS_COVERAGE[bare(grant.ref)];
          if (!audit) wrong.push(`${grant.ref}: no verdict`);
          else if (!agrees(grant.feature, audit.verdict)) wrong.push(`${grant.ref}: ${grant.feature.automationSupport}${grant.feature.informational ? " (informational)" : ""} but the audit says ${audit.verdict}`);
        }
      }
    }
    for (const feat of SRD_2024_CATALOG.feats) {
      const audit = FEAT_COVERAGE[feat.id.replace("srd:feat:", "")]!;
      const record = feat.grants.find((grant) => grant.key === "feat")?.feature;
      if (typeof record !== "object") wrong.push(`${feat.id}: no feature`);
      else if (!agrees(record, audit.verdict)) wrong.push(`${feat.id}: ${record.automationSupport} but the audit says ${audit.verdict}`);
    }
    expect(wrong).toEqual([]);
  });

  it("builds every class it has at every level with its suggestions, without a warning", { timeout: 120000 }, () => {
    for (const definition of SRD_2024_CATALOG.classes) {
      for (let level = 1; level <= 20; level += 1) {
        const built = buildCharacter(quickBuild(SRD_BUILD_SOURCES, { classId: definition.id, level }), SRD_BUILD_SOURCES);
        expect(built.warnings, `${definition.id} ${level}`).toEqual([]);
        expect(built.choices.filter((choice) => choice.pending).map((choice) => choice.path.join("/")), `${definition.id} ${level}`).toEqual([]);
        // No builder-made action leans on a note rider: the AI would stop using it.
        for (const { feature } of built.features) {
          for (const action of feature.grantedActions ?? []) {
            expect("riders" in action && action.riders?.some((rider) => rider.kind === "note"), `${feature.name}`).toBeFalsy();
          }
        }
        for (const { spell } of built.spells) {
          const action = spell.action;
          expect(action && "riders" in action && action.riders?.some((rider) => rider.kind === "note"), `${definition.id} ${level} ${spell.name}`).toBeFalsy();
        }
      }
    }
  });

  it("names only spells the library has: in suggestions, grants and choices' options", () => {
    const missing: string[] = [];
    const check = (where: string, id: string) => { if (!SRD_BUILDER_LIBRARY.spell!(id)) missing.push(`${where}: ${id}`); };
    const grants = (where: string, list: FeatureGrant[] = [], choices: ChoiceSpec[] = []) => {
      for (const grant of list) {
        for (const id of grant.spells ?? []) check(where, id);
        for (const free of grant.freeCasts ?? []) check(where, free.spell);
      }
      for (const spec of choices) if (spec.kind === "pick") for (const option of spec.options) grants(`${where} ${option.id}`, option.grants, option.choices);
    };
    for (const definition of SRD_2024_CATALOG.classes) {
      for (const id of [...(definition.suggested.cantrips ?? []), ...(definition.suggested.spells ?? [])]) check(`${definition.id} suggestions`, id);
      for (const level of definition.levels) grants(`${definition.id} ${level.level}`, level.grants, level.choices);
    }
    for (const subclass of SRD_2024_CATALOG.subclasses) for (const level of subclass.levels) grants(`${subclass.id} ${level.level}`, level.grants, level.choices);
    expect(missing).toEqual([]);
  });

  it("levels every class from 1 to 20 into a valid actor, which the AI fights with using only legal actions", { timeout: 180000 }, () => {
    const problems: string[] = [];
    for (const definition of SRD_2024_CATALOG.classes) {
      // Leveled up one level at a time, as the level-up window does: the new level's choices suggested.
      let build = quickBuild(SRD_BUILD_SOURCES, { classId: definition.id, level: 1 });
      let actor = rebuildActor(blankCharacter("def-fighter", definition.name), build, SRD_BUILD_SOURCES).definition;
      for (let level = 1; level <= 20; level += 1) {
        if (level > 1) {
          build = withSuggestions(withLevelUp(readBuild(actor)!), SRD_BUILD_SOURCES);
          actor = rebuildActor(actor, build, SRD_BUILD_SOURCES).definition;
        }
        const parsed = creatureDefinitionSchema.safeParse(actor);
        if (!parsed.success) problems.push(`${definition.id} ${level}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
        if (level % 4 !== 1 && level !== 20) continue;
        const snapshot = structuredClone(sampleEncounter);
        snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), actor];
        for (const token of snapshot.combatants) {
          if (token.id === "pc-fighter") { token.currentHp = actor.maxHp; token.resources = { ...(actor.resources ?? {}) }; }
        }
        const result = runAutomatedEncounter({ ...snapshot, seed: `${definition.id}-${level}` }, 6);
        // A Large summon (Find Steed) can be boxed in by the sample's cramped room: the map, not an illegal action.
        const summoned = result.log.filter((entry) => entry.type === "CombatantSpawned")
          .flatMap((entry) => ((entry.data?.combatants ?? []) as Array<{ displayName: string }>).map((combatant) => combatant.displayName));
        const stuck = (warning: string) => summoned.some((name) => warning.startsWith(`${name} could not reach`) || warning.startsWith(`${name} found no legal movement`));
        for (const warning of result.outcome.warnings) if (!stuck(warning)) problems.push(`${definition.id} ${level}: ${warning}`);
      }
      expect(readBuild(actor)?.levels).toHaveLength(20);
    }
    expect(problems).toEqual([]);
  });

  it("gives every background and its feat a build", () => {
    for (const background of SRD_2024_CATALOG.backgrounds) {
      const built = buildCharacter(quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:rogue", backgroundId: background.id }), SRD_BUILD_SOURCES);
      expect(built.warnings, background.id).toEqual([]);
      expect(built.features.some((entry) => entry.key.startsWith(`feat:${background.feat}@background`)), background.id).toBe(true);
    }
  });
});
