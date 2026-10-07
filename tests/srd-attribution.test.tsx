// @vitest-environment happy-dom
import { readFileSync, readdirSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openAdd } from "./helpers/abilities-tab";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SRD_52_ATTRIBUTION, SRD_ATTRIBUTION, SRD_CREDITS_PATH, SRD_MODIFICATION_NOTICE } from "@/data/srd/attribution";
import { DocsPage } from "@/components/docs/DocsPage";
import { ActorsPanel } from "@/components/sidebar/ActorsPanel";

/**
 * The statement below is copied VERBATIM from the "Legal Information" page of Wizards' SRD_CC_v5.1.pdf
 * (checked 2026-09-20). It is deliberately a second, independent copy: if anyone rewords the constant, the
 * README, the generated data or the UI, this test fails. The SRD asks for exactly this text and says
 * "Please do not include any other attribution regarding Wizards".
 */
const OFFICIAL =
  "This work includes material taken from the System Reference Document 5.1 (\"SRD 5.1\") by Wizards of the Coast LLC and available at "
  + "https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 "
  + "International License available at https://creativecommons.org/licenses/by/4.0/legalcode.";

/**
 * The same for SRD 5.2, copied VERBATIM from the "Legal Information" page of SRD_CC_v5.2.pdf (checked 2026-10-05):
 * its curly quotes, its commas, and "https://" (the PDF's "https:/ /" is a kerning gap, not a space).
 */
const OFFICIAL_52 =
  "This work includes material from the System Reference Document 5.2 (“SRD 5.2”) by Wizards of the Coast LLC, available at "
  + "https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, "
  + "available at https://creativecommons.org/licenses/by/4.0/legalcode.";

const root = `${process.cwd().replace(/[\/]+$/, "")}/`; // vitest runs from the repo root
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

beforeAll(() => {
  // The docs page watches its sections with an IntersectionObserver, which happy-dom lacks.
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("SRD attribution", () => {
  it("is exactly the statement the SRD 5.1 asks for", () => {
    expect(SRD_ATTRIBUTION).toBe(OFFICIAL);
  });

  it("is exactly the statement the SRD 5.2 asks for", () => {
    expect(SRD_52_ATTRIBUTION).toBe(OFFICIAL_52);
  });

  it("indicates modification (CC-BY §3(a)) without adding any other attribution regarding Wizards", () => {
    expect(SRD_MODIFICATION_NOTICE).toMatch(/modified/i);
    expect(SRD_MODIFICATION_NOTICE).not.toMatch(/wizards|dungeons|d&d|wotc/i);
  });

  it("is in every generated data file", () => {
    const dir = `${root}src/data/srd/monsters/generated/`;
    const files = ["monster-index.json", ...readdirSync(`${dir}chunks`).map((name) => `chunks/${name}`)];
    expect(files.length).toBe(15);
    for (const file of files) {
      const { attribution } = JSON.parse(readFileSync(`${dir}${file}`, "utf8")) as { attribution: string };
      expect(attribution, file).toBe(OFFICIAL);
    }
  });

  it("is in the READMEs", () => {
    for (const file of ["README.md", "src/data/srd/README.md"]) {
      expect(squash(readFileSync(`${root}${file}`, "utf8")), file).toContain(OFFICIAL);
      expect(squash(readFileSync(`${root}${file}`, "utf8")), file).toContain(OFFICIAL_52);
    }
    expect(squash(readFileSync(`${root}README.md`, "utf8"))).toContain(squash(SRD_MODIFICATION_NOTICE));
  });
});

describe("credits in the app", () => {
  it("the Docs page has a Credits & Licensing section with the exact statement and working links", () => {
    render(<DocsPage />);
    const section = document.getElementById("credits")!;
    expect(section).toBeTruthy();
    expect(within(section).getByRole("heading", { name: "Credits & Licensing" })).toBeTruthy();
    // Links wrap the URLs but never change the text.
    expect(squash(document.getElementById("srd-attribution")!.textContent ?? "")).toBe(OFFICIAL);
    const licence = within(section).getAllByRole("link", { name: "https://creativecommons.org/licenses/by/4.0/legalcode" });
    expect(licence.map((link) => link.getAttribute("href"))).toEqual(Array(2).fill("https://creativecommons.org/licenses/by/4.0/legalcode"));
    expect(within(section).getByRole("link", { name: "https://dnd.wizards.com/resources/systems-reference-document" }).getAttribute("href")).toBe("https://dnd.wizards.com/resources/systems-reference-document");
    expect(squash(document.getElementById("srd-52-attribution")!.textContent ?? "")).toBe(OFFICIAL_52);
    expect(within(section).getByRole("link", { name: "https://www.dndbeyond.com/srd" }).getAttribute("href")).toBe("https://www.dndbeyond.com/srd");
    expect(section.textContent).toContain(SRD_MODIFICATION_NOTICE);
    // It is reachable from the docs nav.
    expect(screen.getByRole("link", { name: "Credits & Licensing" }).getAttribute("href")).toBe("#credits");
  });

  it("the spell / weapon / feature library browser links to it too", async () => {
    const { useEncounterStore } = await import("@/store/encounter-store");
    const { ActionsTab } = await import("@/components/sheet/sheet-tabs/ActionsTab");
    const encounter = useEncounterStore.getState().encounter;
    render(<ActionsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />);
    await openAdd();
    const link = screen.getByRole("link", { name: /SRD 5.1 credits/ });
    expect(link.getAttribute("href")).toBe(SRD_CREDITS_PATH);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("the SRD Monsters folder links to it in a new tab", async () => {
    function Harness() {
      return <ActorsPanel onOpenCreate={vi.fn()} onOpenSheet={vi.fn()} />;
    }
    render(<Harness />);
    const rootNode = screen.getByTestId("srd-monsters-root");
    expect(within(rootNode).queryByRole("link", { name: /SRD 5.1 credits/ })).toBeNull(); // only once opened
    await userEvent.click(within(rootNode).getByText("SRD Monsters"));
    const link = within(rootNode).getByRole("link", { name: /SRD 5.1 credits/ });
    expect(link.getAttribute("href")).toBe(SRD_CREDITS_PATH);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
