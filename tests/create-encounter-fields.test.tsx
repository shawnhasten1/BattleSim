// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateEncounterModal, type CreateEncounterResult } from "@/components/modals/CreateEncounterModal";
import type { ImagePixelSize } from "@/lib/imageResize";

/** The size the next picked file "measures" as: happy-dom can't decode images. */
let nextSize: ImagePixelSize | null = null;

vi.mock("@/lib/imageResize", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/imageResize")>()),
  readMapImageFile: vi.fn(async (file: File) => ({ dataUrl: "data:image/png;base64,AAAA", fileName: file.name, size: nextSize }))
}));

const USUAL_KEY = "battlesim:map-import:px-per-square";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => cleanup());

function renderModal() {
  const onSubmit = vi.fn<(result: CreateEncounterResult) => void>();
  render(<CreateEncounterModal onClose={() => undefined} onSubmit={onSubmit} defaultName="Crypt" />);
  return onSubmit;
}

async function pickImage(size: ImagePixelSize | null, name = "crypt.png") {
  nextSize = size;
  await userEvent.upload(screen.getByLabelText(/background image/i), new File(["x"], name, { type: "image/png" }));
}

const fitGroup = () => screen.getByRole("group", { name: "Grid from the image" });
const fitText = () => fitGroup().textContent ?? "";

async function submitted(onSubmit: ReturnType<typeof renderModal>): Promise<Extract<CreateEncounterResult, { mode: "fresh" }>> {
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  return onSubmit.mock.calls[0]![0] as Extract<CreateEncounterResult, { mode: "fresh" }>;
}

describe("New Encounter reads the grid off the background", () => {
  it("applies a 100 px export's grid with nothing typed, and offers the other readings", async () => {
    const onSubmit = renderModal();
    await pickImage({ widthPx: 3000, heightPx: 2000 });
    await waitFor(() => expect(fitText()).toContain("30 × 20 squares"));
    expect(fitText()).toContain("150 × 100 ft · 100 px per square");
    expect(fitText()).toContain("the usual VTT size");
    expect(within(fitGroup()).getByRole("button", { name: "15 × 10 · 200 px" })).toBeTruthy();
    expect(within(fitGroup()).getByRole("button", { name: "60 × 40 · 50 px" })).toBeTruthy();
    // The presets give way to the image's grid.
    expect(screen.queryByRole("button", { name: "Landscape 40×30" })).toBeNull();

    const result = await submitted(onSubmit);
    expect(result.grid).toMatchObject({ width: 30, height: 20, pxPerSquare: 100 });
    expect(result.image).toMatchObject({ fileName: "crypt.png", size: { widthPx: 3000, heightPx: 2000 } });
  });

  it("switches to another reading in one click, and remembers its size", async () => {
    const onSubmit = renderModal();
    await pickImage({ widthPx: 3000, heightPx: 2000 });
    await userEvent.click(await screen.findByRole("button", { name: "15 × 10 · 200 px" }));
    expect(fitText()).toContain("15 × 10 squares");
    expect(fitText()).toContain("a common VTT size");
    // The reading it replaced is now the one a click away.
    expect(within(fitGroup()).getByRole("button", { name: "30 × 20 · 100 px" })).toBeTruthy();
    expect(localStorage.getItem(USUAL_KEY)).toBe("200");

    const result = await submitted(onSubmit);
    expect(result.grid).toMatchObject({ width: 15, height: 10, pxPerSquare: 200 });
  });

  it("types squares across or px per square, each filling in the other", async () => {
    const onSubmit = renderModal();
    await pickImage({ widthPx: 3000, heightPx: 2000 });
    await userEvent.click(await screen.findByRole("button", { name: "Other…" }));
    const across = screen.getByLabelText("Squares across");
    const px = screen.getByLabelText("Image px per square");
    expect((across as HTMLInputElement).value).toBe("30");
    expect((px as HTMLInputElement).value).toBe("100");

    await userEvent.clear(across);
    await userEvent.type(across, "40");
    expect(fitText()).toContain("40 × 27 squares");
    expect((px as HTMLInputElement).value).toBe("75");
    // A count worked out from squares across is a one-off, so it isn't remembered.
    expect(localStorage.getItem(USUAL_KEY)).toBeNull();

    await userEvent.clear(px);
    await userEvent.type(px, "140");
    expect(fitText()).toContain("22 × 15 squares");
    expect((across as HTMLInputElement).value).toBe("22");
    expect(localStorage.getItem(USUAL_KEY)).toBe("140");

    const result = await submitted(onSubmit);
    expect(result.grid).toMatchObject({ width: 22, height: 15, pxPerSquare: 140 });
  });

  it("says when a typed size is out of bounds, and doesn't apply it", async () => {
    renderModal();
    await pickImage({ widthPx: 3000, heightPx: 2000 });
    await userEvent.click(await screen.findByRole("button", { name: "Other…" }));
    const px = screen.getByLabelText("Image px per square");
    await userEvent.clear(px);
    await userEvent.type(px, "10");
    expect(screen.getByRole("alert").textContent).toContain("That's 300 × 200 squares; a map can be 4–120 squares a side.");
    expect(fitText()).toContain("30 × 20 squares");
  });

  it("asks how many squares across an image that isn't a VTT export is", async () => {
    const onSubmit = renderModal();
    await pickImage({ widthPx: 2048, heightPx: 1536 }, "plain-2k.jpg");
    await waitFor(() => expect(fitText()).toContain("doesn't match a VTT export"));
    // Nothing to offer, so the boxes are open.
    await userEvent.type(screen.getByLabelText("Squares across"), "40");
    expect(fitText()).toContain("40 × 30 squares");
    expect(fitText()).toContain("51.2 px per square");
    // Once a typed reading is in use the boxes stay open, mid-edit.
    expect((screen.getByLabelText("Squares across") as HTMLInputElement).value).toBe("40");

    const result = await submitted(onSubmit);
    expect(result.grid).toMatchObject({ width: 40, height: 30, pxPerSquare: 51.2 });
  });

  it("brings the presets back when the image is removed", async () => {
    const onSubmit = renderModal();
    await pickImage({ widthPx: 3000, heightPx: 2000 });
    await waitFor(() => expect(fitText()).toContain("30 × 20 squares"));
    await userEvent.click(screen.getByRole("button", { name: /Remove image/ }));
    expect(screen.getByRole("button", { name: "Landscape 40×30" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Grid from the image" })).toBeNull();

    const result = await submitted(onSubmit);
    expect(result.image).toBeNull();
    expect(result.grid).toMatchObject({ width: 40, height: 30 });
    expect(result.grid.pxPerSquare).toBeUndefined();
  });

  it("falls back to the presets for an image whose size can't be read", async () => {
    renderModal();
    await pickImage(null);
    await waitFor(() => expect(screen.getByText(/Couldn.t read this image.s size/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Landscape 40×30" })).toBeTruthy();
  });
});
