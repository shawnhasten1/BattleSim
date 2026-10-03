import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetTokenPackStoreForTests,
  clearTokenImages,
  deleteTokenImage,
  listTokenImageSlugs,
  listTokenImages,
  putTokenImages
} from "@/lib/tokenPackStore";
import { __resetTokenPackForTests, useTokenPackStore } from "@/store/token-pack-store";

const png = (text: string) => new Blob([text], { type: "image/png" });

beforeEach(() => {
  __resetTokenPackStoreForTests();
  __resetTokenPackForTests();
});

afterEach(async () => {
  await clearTokenImages();
});

describe("tokenPackStore (IndexedDB)", () => {
  it("round-trips images by slug", async () => {
    await putTokenImages([{ slug: "goblin", blob: png("g") }, { slug: "orc", blob: png("o") }]);
    const stored = await listTokenImages();
    expect(stored.map((image) => image.slug).sort()).toEqual(["goblin", "orc"]);
    expect((await listTokenImageSlugs()).sort()).toEqual(["goblin", "orc"]);
    expect(await stored.find((image) => image.slug === "goblin")!.blob.text()).toBe("g");
  });

  it("replaces, deletes and clears", async () => {
    await putTokenImages([{ slug: "goblin", blob: png("old") }]);
    await putTokenImages([{ slug: "goblin", blob: png("new") }]);
    expect(await (await listTokenImages())[0]!.blob.text()).toBe("new");
    await deleteTokenImage("goblin");
    expect(await listTokenImages()).toEqual([]);
    await putTokenImages([{ slug: "orc", blob: png("o") }]);
    await clearTokenImages();
    expect(await listTokenImages()).toEqual([]);
  });
});

describe("token pack store", () => {
  it("hydrates stored images as object URLs", async () => {
    await putTokenImages([{ slug: "goblin", blob: png("g") }]);
    await useTokenPackStore.getState().hydrate();
    const { images, hydrated } = useTokenPackStore.getState();
    expect(hydrated).toBe(true);
    expect(images.goblin).toMatch(/^blob:/);
  });

  it("shows saved images at once and keeps them across a reload", async () => {
    await useTokenPackStore.getState().hydrate();
    expect(await useTokenPackStore.getState().save([{ slug: "orc", blob: png("o") }])).toBe(true);
    expect(useTokenPackStore.getState().images.orc).toMatch(/^blob:/);

    __resetTokenPackForTests();
    await useTokenPackStore.getState().hydrate();
    expect(Object.keys(useTokenPackStore.getState().images)).toEqual(["orc"]);
  });

  it("removes one image, or all of them", async () => {
    await useTokenPackStore.getState().save([{ slug: "orc", blob: png("o") }, { slug: "goblin", blob: png("g") }]);
    await useTokenPackStore.getState().remove("orc");
    expect(Object.keys(useTokenPackStore.getState().images)).toEqual(["goblin"]);
    expect((await listTokenImages()).map((image) => image.slug)).toEqual(["goblin"]);
    await useTokenPackStore.getState().clear();
    expect(useTokenPackStore.getState().images).toEqual({});
    expect(await listTokenImages()).toEqual([]);
  });
});
