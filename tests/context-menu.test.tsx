// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "@/components/ui/ContextMenu";

afterEach(() => cleanup());

const nextFrame = () => act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(null))); });

describe("ContextMenu", () => {
  it("isn't closed by a scroll that was already on its way when it opened, but is by a later one", async () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={[{ label: "Prone", onSelect: () => undefined }]} onClose={onClose} />);
    expect(screen.getByRole("menu")).toBeTruthy();
    // The scroll that brought its button into view, delivered on the frame it opens in.
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(onClose).not.toHaveBeenCalled();
    await nextFrame();
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a press outside it", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={[{ label: "Prone", onSelect: () => undefined }]} onClose={onClose} />);
    act(() => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
