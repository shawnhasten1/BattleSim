import { describe, expect, it } from "vitest";
import {
  COMMON,
  EFFECT_KINDS,
  EFFECT_SPECS,
  GROUPS,
  bestOf,
  searchEffects,
  searchTokens,
  type EffectKindSpec
} from "@/lib/ability-editor/effects";

/** EFFECTS_PLAN.md, Phase 0: what the Add effect picker finds, and the registry it reads. */

/** The first result's best row: an example's label, or the kind. */
const top = (query: string, offered?: (spec: EffectKindSpec) => boolean) => {
  const [first] = searchEffects(query, offered);
  if (!first) return undefined;
  const best = bestOf(first);
  return { kind: first.spec.kind, example: best.example?.label };
};
const kinds = (query: string) => searchEffects(query).map((result) => result.spec.kind);

describe("the picker's registry", () => {
  it("puts every kind in a group, with words to find it by", () => {
    for (const spec of EFFECT_KINDS) {
      expect(GROUPS.map((entry) => entry.group), spec.kind).toContain(spec.group);
      expect(spec.keywords.length, spec.kind).toBeGreaterThan(0);
    }
  });

  it("fills each example in with its own kind", () => {
    for (const spec of EFFECT_KINDS) {
      for (const example of spec.examples ?? []) {
        const effects = example.effects();
        expect(effects.length, example.label).toBeGreaterThan(0);
        for (const effect of effects) expect(effect.kind, example.label).toBe(spec.kind);
        // A fresh copy each time: editing one card never changes the example.
        expect(example.effects()[0]).not.toBe(effects[0]);
      }
    }
  });

  it("names no example as a kind starts, so a row is never mistaken for the kind", () => {
    const labels = EFFECT_KINDS.map((spec) => spec.label);
    for (const spec of EFFECT_KINDS) {
      const names = (spec.examples ?? []).map((example) => example.label);
      expect(new Set(names).size, spec.kind).toBe(names.length);
      for (const name of names) for (const label of labels) expect(name.startsWith(label), `${name} / ${label}`).toBe(false);
    }
  });

  it("gives every effect in a Common row a short name", () => {
    for (const list of Object.values(COMMON)) {
      for (const kind of list) {
        expect(EFFECT_SPECS[kind], kind).toBeDefined();
        expect(EFFECT_SPECS[kind].short, kind).toBeTruthy();
      }
    }
  });
});

describe("searching for an effect", () => {
  it("drops the little words and punctuation", () => {
    expect(searchTokens("The Hunter's Mark")).toEqual(["hunters", "mark"]);
    expect(searchTokens("+1 to AC")).toEqual(["+1", "ac"]);
    expect(searchEffects("of the")).toEqual([]);
  });

  it("finds the kind a DM has in mind first", () => {
    expect(top("resistance")?.kind).toBe("damage-adjustment");
    expect(top("resist")?.kind).toBe("damage-adjustment");
    expect(top("ac")?.kind).toBe("armor-class-bonus");
    expect(top("regen")?.kind).toBe("hp-regen");
    expect(top("legendary")?.kind).toBe("auto-succeed-save");
    expect(top("initiative")?.kind).toBe("initiative");
    expect(top("reroll")?.kind).toBe("d20-change");
    expect(top("smite")?.kind).toBe("on-hit-option");
    expect(kinds("crit").slice(0, 2)).toEqual(expect.arrayContaining(["critical-range"]));
    expect(kinds("advantage")).toEqual(expect.arrayContaining(["attack-advantage", "save-advantage", "incoming-attack-modifier"]));
  });

  it("goes straight to a named example", () => {
    expect(top("pack tactics")).toEqual({ kind: "attack-advantage", example: "Pack Tactics" });
    expect(top("magic resistance")).toEqual({ kind: "save-advantage", example: "Magic Resistance" });
    expect(top("resilient")).toEqual({ kind: "save-bonus", example: "Proficiency in one save, like Resilient" });
    expect(top("troll")).toEqual({ kind: "hp-regen", example: "Troll Regeneration" });
    expect(top("hunter's mark")).toEqual({ kind: "incoming-hit-damage", example: "Hunter's Mark" });
    expect(top("fire resistance")).toEqual({ kind: "damage-adjustment", example: "Fire resistance, like a Ring of Resistance" });
  });

  it("lists every example of a kind that matches, the matching ones first", () => {
    const [resistance] = searchEffects("resistance");
    expect(resistance!.examples.map((entry) => entry.example.label)).toHaveLength(EFFECT_SPECS["damage-adjustment"].examples!.length);
    const [fire] = searchEffects("fire resistance");
    expect(fire!.examples[0]!.example.label).toMatch(/^Fire resistance/);
  });

  it("lists only the matching examples when the kind itself doesn't match", () => {
    const result = searchEffects("zombie").find((entry) => entry.spec.kind === "survive-lethal")!;
    expect(result.score).toBe(0);
    expect(result.examples.map((entry) => entry.example.label)).toEqual(["Undead Fortitude"]);
  });

  it("leaves out what can't go here", () => {
    const noMarks = (spec: EffectKindSpec) => !spec.conditionOnly;
    expect(searchEffects("mark", noMarks).map((result) => result.spec.kind)).not.toContain("incoming-hit-damage");
  });

  it("finds speed by the words a DM uses for it", () => {
    for (const query of ["speed", "boots", "fast", "fly", "swim", "longstrider"]) expect(top(query)?.kind, query).toBe("speed");
    expect(top("boots of speed")).toEqual({ kind: "speed", example: "Doubled, like Boots of Speed" });
    expect(top("fast movement")).toEqual({ kind: "speed", example: "+10 ft without heavy armor, like Fast Movement" });
  });

  it("finds nothing for what isn't an effect yet", () => {
    expect(searchEffects("xylophone")).toEqual([]);
  });
});
