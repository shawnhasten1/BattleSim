import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetMapImageStoreForTests,
  copyMapImage,
  deleteMapImage,
  getMapImage,
  listMapImageKeys,
  pruneMapImages,
  putMapImage
} from "@/lib/mapImageStore";

const IMG_A = "data:image/jpeg;base64,QQ==";
const IMG_B = "data:image/jpeg;base64,Qg==";

beforeEach(() => {
  __resetMapImageStoreForTests();
});

afterEach(async () => {
  await pruneMapImages([]); // wipe the store between tests
});

describe("mapImageStore", () => {
  it("round-trips an image by key", async () => {
    await putMapImage("enc-1", IMG_A);
    expect(await getMapImage("enc-1")).toBe(IMG_A);
  });

  it("returns null for an unknown key and for an empty key", async () => {
    expect(await getMapImage("nope")).toBeNull();
    expect(await getMapImage("")).toBeNull();
  });

  it("overwrites on a second put", async () => {
    await putMapImage("enc-1", IMG_A);
    await putMapImage("enc-1", IMG_B);
    expect(await getMapImage("enc-1")).toBe(IMG_B);
  });

  it("deletes an image", async () => {
    await putMapImage("enc-1", IMG_A);
    await deleteMapImage("enc-1");
    expect(await getMapImage("enc-1")).toBeNull();
  });

  it("copies an image to a new key, leaving the source in place", async () => {
    await putMapImage("src", IMG_A);
    await copyMapImage("src", "dst");
    expect(await getMapImage("dst")).toBe(IMG_A);
    expect(await getMapImage("src")).toBe(IMG_A);
  });

  it("copy is a no-op when the source is missing", async () => {
    await copyMapImage("ghost", "dst");
    expect(await getMapImage("dst")).toBeNull();
  });

  it("prunes keys that are not in the keep set", async () => {
    await putMapImage("keep-1", IMG_A);
    await putMapImage("keep-2", IMG_A);
    await putMapImage("drop-1", IMG_B);
    await pruneMapImages(["keep-1", "keep-2"]);
    expect((await listMapImageKeys()).sort()).toEqual(["keep-1", "keep-2"]);
  });
});

describe("mapImageStore without IndexedDB", () => {
  let saved: unknown;
  beforeEach(() => {
    __resetMapImageStoreForTests();
    saved = (globalThis as Record<string, unknown>).indexedDB;
    delete (globalThis as Record<string, unknown>).indexedDB;
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>).indexedDB = saved;
    __resetMapImageStoreForTests();
  });

  it("degrades to null / no-op instead of throwing", async () => {
    await expect(putMapImage("enc-1", IMG_A)).resolves.toBeUndefined();
    await expect(getMapImage("enc-1")).resolves.toBeNull();
    await expect(deleteMapImage("enc-1")).resolves.toBeUndefined();
    await expect(listMapImageKeys()).resolves.toEqual([]);
  });
});
