import { describe, expect, it } from "vitest";
import { SRD_MONSTER_INDEX_WITH_FORMS } from "@/data/srd/monsters";
import { TWIN_SLUGS, matchTokenFile, matchTokenFiles, nameWords } from "@/lib/token-pack-match";

const targets = SRD_MONSTER_INDEX_WITH_FORMS.map(({ slug, name }) => ({ slug, name }));
const match = (fileName: string) => matchTokenFile(fileName, targets);

describe("token pack file matching", () => {
  it("reduces a file name to its meaningful words", () => {
    expect(nameWords("Ancient_Red_Dragon_Token_01.webp")).toEqual(["ancient", "red", "dragon"]);
    expect(nameWords("AncientRedDragon_Huge_Scale.png")).toEqual(["ancient", "red", "dragon"]);
    expect(nameWords("tokens/beasts/Swarm-of-Rats-A1.PNG")).toEqual(["swarm", "rats"]);
    expect(nameWords("Will-o'-Wisp")).toEqual(["will", "o", "wisp"]);
  });

  it("matches the same words in any order exactly", () => {
    expect(match("Ancient_Red_Dragon.png")).toMatchObject({ slug: "ancient-red-dragon", kind: "exact" });
    expect(match("Dragon-Red-Ancient_topdown.webp")).toMatchObject({ slug: "ancient-red-dragon", kind: "exact" });
    expect(match("goblin 2.jpg")).toMatchObject({ slug: "goblin", kind: "exact" });
    expect(match("Werewolf_Wolf.png")).toMatchObject({ slug: "werewolf--wolf", kind: "exact" });
    expect(match("Will_o_Wisp.png")).toMatchObject({ slug: "will-o-wisp", kind: "exact" });
    expect(match("Elf, Drow.png")).toMatchObject({ slug: "elf-drow", kind: "exact" });
    expect(match("Owl Bear.png")).toMatchObject({ slug: "owlbear", kind: "exact" });
    expect(match("SabertoothedTiger.png")).toMatchObject({ slug: "saber-toothed-tiger", kind: "exact" });
  });

  it("suggests the closest monster when most of the words agree", () => {
    expect(match("Giant_Wolf_Spidr.png")).toMatchObject({ kind: "suggested" });
    expect(match("Red_Dragon_Adult_Young.png")).toMatchObject({ kind: "suggested" });
  });

  it("leaves names with nothing in common unmatched", () => {
    expect(match("Banana.png")).toEqual({ kind: "unmatched", score: 0 });
    expect(match("Token_01.png")).toEqual({ kind: "unmatched", score: 0 });
  });

  it("uses the first file for a monster and marks the rest as extras, exact before suggested", () => {
    const result = matchTokenFiles(["Goblin_02.png", "Goblin_01.png", "Goblin Boss.png", "Orc.png"], targets);
    expect(result.find((row) => row.fileName === "Goblin_01.png")).toMatchObject({ slug: "goblin", kind: "exact" });
    expect(result.find((row) => row.fileName === "Goblin_01.png")?.duplicate).toBeUndefined();
    expect(result.find((row) => row.fileName === "Goblin_02.png")).toMatchObject({ slug: "goblin", duplicate: true });
    // "Goblin Boss" isn't an SRD monster: its best guess is Goblin, which the exact match already has.
    expect(result.find((row) => row.fileName === "Goblin Boss.png")).toMatchObject({ slug: "goblin", kind: "suggested", duplicate: true });
    expect(result.find((row) => row.fileName === "Orc.png")).toMatchObject({ slug: "orc", kind: "exact" });
    expect(result.map((row) => row.index)).toEqual([0, 1, 2, 3]);
  });

  it("knows the library's two-name creatures are one creature", () => {
    for (const [slug, twins] of Object.entries(TWIN_SLUGS)) {
      for (const twin of twins) expect(TWIN_SLUGS[twin]).toContain(slug);
      expect(targets.some((target) => target.slug === slug)).toBe(true);
    }
  });
});
