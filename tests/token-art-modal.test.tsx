// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenArtModal } from "@/components/sidebar/TokenArtModal";
import { ActorThumbnail } from "@/components/ActorThumbnail";
import { __resetTokenPackStoreForTests, clearTokenImages, listTokenImageSlugs } from "@/lib/tokenPackStore";
import { __resetTokenPackForTests, useTokenPackStore } from "@/store/token-pack-store";

// Decoding images isn't what's under test (happy-dom doesn't decode them): store what was picked.
vi.mock("@/lib/imageResize", () => ({ downscaleTokenImage: async (file: Blob) => file }));

beforeEach(() => {
  __resetTokenPackStoreForTests();
  __resetTokenPackForTests();
});
afterEach(async () => {
  cleanup();
  await clearTokenImages();
});

const png = (name: string) => new File([name], name, { type: "image/png" });
const imagesInput = () => document.querySelector<HTMLInputElement>('input[type="file"][multiple][accept]')!;

describe("SRD token art import", () => {
  it("matches picked files to monsters, saves the sure ones, and asks about the rest", async () => {
    const user = userEvent.setup();
    render(<TokenArtModal onClose={() => {}} />);
    expect(screen.getByText(/stays in this browser on this device/)).toBeTruthy();
    expect(screen.getByText(/0 of \d+ monsters use your art/)).toBeTruthy();

    await user.upload(imagesInput(), [png("Goblin_Token.png"), png("Dragon_Red_Ancient.png"), png("Giant_Wolf_Spidr.png"), png("Mystery.png")]);

    expect(screen.getByText("2 matched · 1 to confirm · 1 not matched")).toBeTruthy();
    expect((screen.getByLabelText("Use Goblin_Token.png") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Monster for Dragon_Red_Ancient.png") as HTMLInputElement).value).toBe("Ancient Red Dragon");
    // A suggestion waits to be confirmed; an unmatched file can't be used until a monster is picked.
    expect((screen.getByLabelText("Use Giant_Wolf_Spidr.png") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Use Mystery.png") as HTMLInputElement).disabled).toBe(true);

    await user.type(screen.getByLabelText("Monster for Mystery.png"), "Orc");
    expect((screen.getByLabelText("Use Mystery.png") as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole("button", { name: "Save 3 images" }));
    await screen.findByText("Saved 3 images.");
    // (Slugs only: fake-indexeddb can't clone happy-dom's File back into a Blob.)
    expect((await listTokenImageSlugs()).sort()).toEqual(["ancient-red-dragon", "goblin", "orc"]);
    expect(Object.keys(useTokenPackStore.getState().images).sort()).toEqual(["ancient-red-dragon", "goblin", "orc"]);
  });

  it("saves art for a two-name creature under both names", async () => {
    const user = userEvent.setup();
    render(<TokenArtModal onClose={() => {}} />);
    await user.upload(imagesInput(), [png("Drow.png")]);
    await user.click(screen.getByRole("button", { name: "Save 1 image" }));
    await screen.findByText("Saved 1 image.");
    expect((await listTokenImageSlugs()).sort()).toEqual(["drow", "elf-drow"]);
  });

  it("removes all imported art after a confirm", async () => {
    const user = userEvent.setup();
    await useTokenPackStore.getState().save([{ slug: "goblin", blob: png("g") }]);
    render(<TokenArtModal onClose={() => {}} />);
    await screen.findByText(/1 of \d+ monsters use your art/);
    await user.click(screen.getByRole("button", { name: /Remove all/ }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByText(/placeholder tokens again/);
    expect(await listTokenImageSlugs()).toEqual([]);
  });

  it("shows a monster's placeholder, then the art imported for it", async () => {
    render(<ActorThumbnail definition={{ name: "Goblin", source: { provider: "srd", slug: "goblin" } }} />);
    await waitFor(() => expect(document.querySelector("img")?.getAttribute("src")).toBe("/tokens/srd/goblin.svg"));
    await useTokenPackStore.getState().save([{ slug: "goblin", blob: png("g") }]);
    await waitFor(() => expect(document.querySelector("img")?.getAttribute("src")).toMatch(/^blob:/));
  });
});
