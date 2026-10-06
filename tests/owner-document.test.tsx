// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createPortal } from "react-dom";
import { Window as HappyWindow } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActorSheet } from "@/components/sheet/ActorSheet";
import type { Compendium } from "@/hooks/useCompendium";
import { OwnerDocumentContext } from "@/hooks/useOwnerDocument";
import { useEncounterStore } from "@/store/encounter-store";
import { useSheetWindowsStore } from "@/store/sheet-windows-store";
import { resetSheetWindows } from "./helpers/sheet";

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  resetSheetWindows();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;

/** A sheet window, kept up to date from the store. */
function LiveSheet({ id }: { id: string }) {
  const sheet = useSheetWindowsStore((state) => state.windows.find((entry) => entry.id === id));
  return sheet ? <ActorSheet sheet={sheet} rank={0} front compendium={compendium} /> : null;
}

const popups: HappyWindow[] = [];
afterEach(() => {
  // Unmount before the window goes, or React removes nodes from a closed document.
  cleanup();
  popups.splice(0).forEach((popup) => void popup.happyDOM.close());
});

/** The sheet of `combatantId`, rendered into another window's document, the way a popped-out sheet is. */
function renderInOtherDocument(combatantId = "enemy-goblin-1") {
  const popup = new HappyWindow();
  popups.push(popup);
  const other = popup.document as unknown as Document;
  const container = other.createElement("div");
  other.body.appendChild(container);
  const id = useSheetWindowsStore.getState().open(combatantId)!;
  render(
    <OwnerDocumentContext.Provider value={other}>
      {createPortal(<LiveSheet id={id} />, container)}
    </OwnerDocumentContext.Provider>
  );
  return other;
}

const button = (doc: Document, name: string) =>
  [...doc.querySelectorAll("button")].find((candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name)!;

describe("a sheet in another document (a popped-out sheet)", () => {
  it("renders there, not in the main page", () => {
    const other = renderInOtherDocument();
    expect(other.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Imported Goblin Stand-in sheet");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens the ⋯ menu there, and closes it on a click elsewhere there", () => {
    const other = renderInOtherDocument();
    act(() => button(other, "More actions").click());
    expect(other.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    act(() => { fireEvent.pointerDown(other.body); });
    expect(other.querySelector('[role="menu"]')).toBeNull();
  });

  it("opens the condition menu there, and its choice reaches the token", () => {
    const other = renderInOtherDocument();
    act(() => button(other, "+ Condition").click());
    const prone = [...other.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')].find((item) => item.textContent?.startsWith("Prone"));
    expect(prone).toBeTruthy();
    act(() => (prone as HTMLElement).click());
    const goblin = useEncounterStore.getState().encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!;
    expect(goblin.conditions?.map((condition) => condition.name)).toContain("prone");
  });

  it("opens a tooltip there", () => {
    const other = renderInOtherDocument();
    act(() => { fireEvent.mouseEnter(button(other, "About automation levels")); });
    expect(other.querySelector('[role="tooltip"]')).not.toBeNull();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("opens an ability row's ⋯ menu there and closes it on a click elsewhere there", () => {
    const other = renderInOtherDocument();
    act(() => button(other, "Abilities").click());
    const rowMenu = [...other.querySelectorAll("button")].find((candidate) => candidate.getAttribute("aria-label")?.startsWith("More for"));
    expect(rowMenu).toBeTruthy();
    act(() => rowMenu!.click());
    expect(other.querySelector('[role="menu"]')).not.toBeNull();
    act(() => { fireEvent.pointerDown(other.body); });
    expect(other.querySelector('[role="menu"]')).toBeNull();
  });
});

describe("window globals in sheet and UI code", () => {
  // Inside a popped-out sheet these still mean the main window (CHARACTER_SHEET_WINDOWS_PLAN.md Part 2): code there
  // uses the owner document (useOwnerDocument, or an element's ownerDocument) instead. A line that really means the
  // main window says so with "// main-window only".
  const PATTERN = /\bdocument\.(body|activeElement|addEventListener|removeEventListener)\b|\bwindow\.(addEventListener|removeEventListener)\b/;
  const roots = ["src/components/sheet", "src/components/ui"];

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it("are only used where the main window is meant", () => {
    const offenders = roots.flatMap(files).flatMap((path) =>
      readFileSync(path, "utf-8").split(/\r?\n/).flatMap((line, index) =>
        PATTERN.test(line) && !line.includes("main-window only") ? [`${path}:${index + 1}: ${line.trim()}`] : []
      )
    );
    expect(offenders).toEqual([]);
  });
});
