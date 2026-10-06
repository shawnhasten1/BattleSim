// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { Window as HappyWindow } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openPopup, PopoutWindow } from "@/components/ui/PopoutWindow";
import type { Compendium } from "@/hooks/useCompendium";
import { useBuilderUiStore } from "@/store/builder-ui-store";
import { useEncounterStore } from "@/store/encounter-store";
import { useSheetWindowsStore } from "@/store/sheet-windows-store";
import { renderSheet, resetSheetWindows, sheetWindows } from "./helpers/sheet";

/** A stand-in browser window for `window.open`: another happy-dom window that knows when it's been closed. */
interface FakePopup {
  window: Window;
  closed: () => boolean;
  /** The DM closing it with the browser's own close button. */
  closeByHand: () => void;
}

const popups: FakePopup[] = [];
function fakePopup(): FakePopup {
  const happy = new HappyWindow({ width: 800, height: 600 });
  let closed = false;
  const popup = happy as unknown as Window;
  Object.defineProperty(popup, "closed", { get: () => closed, set: (value: boolean) => { closed = value; } });
  popup.close = () => { closed = true; };
  const fake = {
    window: popup,
    closed: () => closed,
    closeByHand: () => {
      popup.dispatchEvent(new (happy.Event as unknown as typeof Event)("pagehide"));
      closed = true;
    }
  };
  popups.push(fake);
  return fake;
}

const pristine = useEncounterStore.getState();
let openSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  resetSheetWindows();
  window.localStorage.clear();
  openSpy = vi.spyOn(window, "open").mockImplementation(() => fakePopup().window);
});
afterEach(async () => {
  cleanup();
  openSpy.mockRestore();
  // Closing waits a tick after unmounting (Strict Mode); let it run before the windows go.
  await new Promise((resolve) => setTimeout(resolve, 0));
  popups.splice(0).forEach((popup) => void (popup.window as unknown as HappyWindow).happyDOM.close());
  document.head.querySelectorAll("style[data-test]").forEach((node) => node.remove());
  document.body.innerHTML = "";
});

const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;
const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("openPopup", () => {
  it("writes a page with the main page's stylesheets and <html> classes", () => {
    const style = document.createElement("style");
    style.dataset.test = "";
    style.textContent = ".from-main { color: red; }";
    document.head.appendChild(style);
    document.documentElement.className = "font-variable";

    const popup = openPopup("test", { width: 700, height: 500, left: 10, top: 20 }, "Goblin — BattleSim")!;
    expect(openSpy).toHaveBeenCalledWith("", "test", "popup,width=700,height=500,left=10,top=20");
    expect(popup.document.title).toBe("Goblin — BattleSim");
    expect(popup.document.documentElement.className).toBe("font-variable");
    expect([...popup.document.head.querySelectorAll("style")].some((node) => node.textContent?.includes(".from-main"))).toBe(true);
    document.documentElement.className = "";
  });

  it("is null when the browser blocks the popup", () => {
    openSpy.mockImplementation(() => null);
    expect(openPopup("test", { width: 700, height: 500 }, "x")).toBeNull();
  });
});

describe("PopoutWindow", () => {
  it("mirrors a stylesheet the main page adds later, and drops it when it goes", async () => {
    const popup = openPopup("test", { width: 700, height: 500 }, "x")!;
    render(<PopoutWindow popup={popup} title="x" onClosed={() => undefined}><p>inside</p></PopoutWindow>);
    expect(popup.document.body.textContent).toContain("inside");
    const late = document.createElement("style");
    late.dataset.test = "";
    late.textContent = ".late { color: blue; }";
    document.head.appendChild(late);
    await tick();
    const copy = () => [...popup.document.head.querySelectorAll("style")].find((node) => node.textContent?.includes(".late"));
    expect(copy()).toBeTruthy();
    late.remove();
    await tick();
    expect(copy()).toBeUndefined();
  });

  it("tells when the DM closes the browser window, with where it was", () => {
    const fake = { current: null as FakePopup | null };
    openSpy.mockImplementation(() => (fake.current = fakePopup()).window);
    const popup = openPopup("test", { width: 700, height: 500 }, "x")!;
    const onClosed = vi.fn();
    const onBounds = vi.fn();
    render(<PopoutWindow popup={popup} title="x" onClosed={onClosed} onBounds={onBounds}><p>inside</p></PopoutWindow>);
    act(() => fake.current!.closeByHand());
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onBounds).toHaveBeenCalledWith(expect.objectContaining({ width: 800, height: 600 }));
  });

  it("closes the browser window when it unmounts, without calling it the DM's close", async () => {
    const fake = { current: null as FakePopup | null };
    openSpy.mockImplementation(() => (fake.current = fakePopup()).window);
    const popup = openPopup("test", { width: 700, height: 500 }, "x")!;
    const onClosed = vi.fn();
    const view = render(<PopoutWindow popup={popup} title="x" onClosed={onClosed}><p>inside</p></PopoutWindow>);
    view.unmount();
    await tick();
    expect(fake.current!.closed()).toBe(true);
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("closes the browser window when the main page goes away", () => {
    const fake = { current: null as FakePopup | null };
    openSpy.mockImplementation(() => (fake.current = fakePopup()).window);
    const popup = openPopup("test", { width: 700, height: 500 }, "x")!;
    render(<PopoutWindow popup={popup} title="x" onClosed={() => undefined}><p>inside</p></PopoutWindow>);
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(fake.current!.closed()).toBe(true);
  });
});

describe("a popped-out sheet", () => {
  const popupDocument = () => popups.at(-1)!.window.document;
  const popupButton = (name: string) =>
    [...popupDocument().querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === name || button.textContent?.trim() === name)!;

  it("moves into its own browser window, and back on Dock, keeping its tab and style", async () => {
    renderSheet(compendium, "enemy-goblin-1");
    act(() => useSheetWindowsStore.getState().setTab(sheetWindows()[0]!.id, "token"));
    act(() => screen.getByRole("button", { name: "Pop out" }).click());
    expect(sheetWindows()[0]!.popup).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(popupDocument().querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Imported Goblin Stand-in sheet");
    expect(popupDocument().title).toBe("Imported Goblin Stand-in · 2 tokens — BattleSim");
    expect(popupButton("Token").getAttribute("aria-selected")).toBe("true");

    act(() => popupButton("Dock").click());
    await tick();
    expect(sheetWindows()[0]!.popup).toBeNull();
    expect(sheetWindows()[0]!.tab).toBe("token");
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Imported Goblin Stand-in sheet");
    expect(popups.at(-1)!.closed()).toBe(true);
  });

  it("keeps an ability being edited through popping out and docking", async () => {
    renderSheet(compendium, "pc-fighter");
    act(() => screen.getByRole("tab", { name: "Abilities" }).click());
    act(() => screen.getByRole("button", { name: "Edit Longsword" }).click());
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(name, "Longsword of Doom");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => screen.getByRole("button", { name: "Pop out" }).click());
    expect([...popupDocument().querySelectorAll("input")].some((input) => input.value === "Longsword of Doom")).toBe(true);
    act(() => popupButton("Dock").click());
    await tick();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Longsword of Doom");
  });

  it("docks back, rather than closing, when its browser window is closed with unsaved changes", async () => {
    renderSheet(compendium, "pc-fighter");
    act(() => screen.getByRole("tab", { name: "Abilities" }).click());
    act(() => screen.getByRole("button", { name: "Edit Longsword" }).click());
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(name, "Longsword!");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => screen.getByRole("button", { name: "Pop out" }).click());
    act(() => popups.at(-1)!.closeByHand());
    await tick();
    expect(sheetWindows()).toHaveLength(1);
    expect(sheetWindows()[0]!.popup).toBeNull();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Longsword!");
  });

  it("closes when its browser window is closed with nothing unsaved", async () => {
    renderSheet(compendium, "pc-fighter");
    act(() => screen.getByRole("button", { name: "Pop out" }).click());
    act(() => popups.at(-1)!.closeByHand());
    await tick();
    expect(sheetWindows()).toHaveLength(0);
  });

  it("says so when the browser blocks the popup, and stays in the page", () => {
    openSpy.mockImplementation(() => null);
    renderSheet(compendium, "pc-fighter");
    act(() => screen.getByRole("button", { name: "Pop out" }).click());
    expect(sheetWindows()[0]!.popup).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Your browser blocked the pop-out");
  });

  it("edits from the popup reach the store, and Undo there takes them back", () => {
    renderSheet(compendium, "pc-fighter");
    act(() => screen.getByRole("button", { name: "Pop out" }).click());
    const temp = popupDocument().querySelector<HTMLInputElement>('input[aria-label="Temporary hit points"]')!;
    // Typed in, with the popup's own classes (a node there belongs to that window).
    const view = popups.at(-1)!.window as unknown as typeof globalThis;
    act(() => {
      temp.focus();
      const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")!.set!;
      setter.call(temp, "9");
      temp.dispatchEvent(new view.Event("input", { bubbles: true }));
    });
    const fighter = () => useEncounterStore.getState().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    expect(fighter().tempHp).toBe(9);
    act(() => popupButton("Undo").click());
    expect(fighter().tempHp).toBe(0);
  });

  it("says a builder window it opened is in the main window", () => {
    renderSheet(compendium, "pc-fighter");
    act(() => screen.getByRole("button", { name: "Pop out" }).click());
    act(() => useBuilderUiStore.getState().open({ kind: "level-up", definitionId: "def-fighter" }));
    expect(popupDocument().querySelector('[role="status"]')?.textContent).toContain("Opened in the main window.");
    act(() => useBuilderUiStore.getState().close());
  });

  it("closes its browser window when the scene changes", async () => {
    renderSheet(compendium, "pc-fighter");
    act(() => screen.getByRole("button", { name: "Pop out" }).click());
    act(() => useEncounterStore.setState({ currentEncounterId: "another-scene" }));
    await tick();
    expect(sheetWindows()).toHaveLength(0);
    expect(popups.at(-1)!.closed()).toBe(true);
  });
});
