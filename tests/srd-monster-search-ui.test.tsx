// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEncounterStore } from "@/store/encounter-store";
import { ActorsPanel } from "@/components/sidebar/ActorsPanel";

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
});
afterEach(() => {
  document.body.innerHTML = "";
});

function Harness() {
  return <ActorsPanel onOpenCreate={vi.fn()} onOpenSheet={vi.fn()} />;
}

/** Renders the panel with the SRD Monsters root already expanded. */
async function openSrd() {
  render(<Harness />);
  const root = screen.getByTestId("srd-monsters-root");
  await userEvent.click(within(root).getByText("SRD Monsters"));
  return root;
}

const search = (root: HTMLElement) => within(root).getByLabelText("Search SRD monsters") as HTMLInputElement;

async function openFilters(root: HTMLElement) {
  await userEvent.click(within(root).getByRole("button", { name: "Filters" }));
}

describe("SRD monster search", { timeout: 20000 }, () => {
  it("shows no search UI until the SRD folder is opened", () => {
    render(<Harness />);
    const root = screen.getByTestId("srd-monsters-root");
    expect(within(root).queryByLabelText("Search SRD monsters")).toBeNull();
  });

  it("narrows the tree as you type, opening the folders that still have matches", async () => {
    const root = await openSrd();
    await userEvent.type(search(root), "wolf");

    expect(within(root).getByRole("status").textContent).toMatch(/of 325 monsters/);
    // Folders with matches open by themselves; folders without any disappear.
    expect(within(root).getByText("Wolf", { exact: true })).toBeTruthy();
    expect(within(root).getByText("Dire Wolf", { exact: true })).toBeTruthy();
    expect(within(root).queryByText("Aberration")).toBeNull();
    expect(within(root).queryByText("Goblin", { exact: true })).toBeNull();
    // The root count reads "matches of total".
    expect(within(root).getByText(/^\d+ of 325$/)).toBeTruthy();
  });

  it("finds things by family and type, not only by name", async () => {
    const root = await openSrd();
    await userEvent.type(search(root), "chromatic");
    expect(within(root).getByRole("status").textContent).toBe("20 of 325 monsters");
    expect(within(root).getByText("Adult Red Dragon", { exact: true })).toBeTruthy();
    expect(within(root).queryByText("Adult Gold Dragon", { exact: true })).toBeNull(); // metallic
  });

  it("lets you collapse a folder while searching, and reopens everything when the search changes", async () => {
    const root = await openSrd();
    await userEvent.type(search(root), "wolf");
    await userEvent.click(within(root).getByRole("button", { name: "Collapse Beast" }));
    expect(within(root).queryByText("Dire Wolf", { exact: true })).toBeNull();

    await userEvent.type(search(root), "s"); // "wolfs" → nothing
    await userEvent.clear(search(root));
    await userEvent.type(search(root), "dire wolf");
    expect(within(root).getByText("Dire Wolf", { exact: true })).toBeTruthy();
  });

  it("says so when nothing matches and offers a way out", async () => {
    const root = await openSrd();
    await userEvent.type(search(root), "zzzzqq");
    expect(within(root).getByText(/No monsters match these filters/)).toBeTruthy();
    await userEvent.click(within(root).getByRole("button", { name: "Clear filters" }));
    expect(search(root).value).toBe("");
    expect(within(root).queryByText(/No monsters match/)).toBeNull();
    expect(within(root).queryByRole("status")).toBeNull();
  });

  it("still adds the monster you found", async () => {
    const root = await openSrd();
    await userEvent.type(search(root), "dire wolf");
    const row = within(root).getByText("Dire Wolf", { exact: true }).closest("li")!;
    await userEvent.click(within(row).getByTitle("Add to the map as an enemy"));
    await vi.waitFor(() => expect(useEncounterStore.getState().encounter.combatants.some((combatant) => combatant.definitionId === "srd:monster:dire-wolf")).toBe(true));
  });
});

describe("SRD monster filters", { timeout: 20000 }, () => {
  it("filters by CR minimum and maximum", async () => {
    const root = await openSrd();
    await openFilters(root);
    await userEvent.selectOptions(within(root).getByLabelText("Minimum challenge rating"), "17");
    expect(within(root).getByRole("status").textContent).toMatch(/^\d+ of 325 monsters$/);
    expect(within(root).getByText("Adult Red Dragon", { exact: true })).toBeTruthy();
    expect(within(root).queryByText("Goblin", { exact: true })).toBeNull();

    await userEvent.selectOptions(within(root).getByLabelText("Maximum challenge rating"), "17");
    // Exactly CR 17: the Adult Red Dragon is one of them and the Ancient ones (CR 20+) are gone.
    expect(within(root).getByText("Adult Red Dragon", { exact: true })).toBeTruthy();
    expect(within(root).queryByText("Ancient Red Dragon", { exact: true })).toBeNull();
    expect(within(root).getByRole("status").textContent).toBe("4 of 325 monsters");
  });

  it("offers fractional ratings and keeps min ≤ max when they cross", async () => {
    const root = await openSrd();
    await openFilters(root);
    const min = within(root).getByLabelText("Minimum challenge rating") as HTMLSelectElement;
    const max = within(root).getByLabelText("Maximum challenge rating") as HTMLSelectElement;
    expect(within(min).getByRole("option", { name: "1/8" })).toBeTruthy();
    expect(within(min).getByRole("option", { name: "1/2" })).toBeTruthy();

    await userEvent.selectOptions(min, "10");
    expect(max.value).toBe(""); // still unbounded
    await userEvent.selectOptions(max, "12");
    await userEvent.selectOptions(min, "14"); // above the max → the max is lifted with it
    expect(min.value).toBe("14");
    expect(max.value).toBe("14");
    await userEvent.selectOptions(max, "5"); // below the min → the min is dragged down
    expect(min.value).toBe("5");
    expect(max.value).toBe("5");
  });

  it("toggles size, automation and trait chips, and combines them with the range", async () => {
    const root = await openSrd();
    await openFilters(root);
    await userEvent.click(within(root).getByRole("button", { name: "Gargantuan" }));
    expect(within(root).getByRole("status").textContent).toBe("15 of 325 monsters");
    await userEvent.click(within(root).getByRole("button", { name: "Tiny" }));
    expect(within(root).getByRole("status").textContent).toBe("39 of 325 monsters");
    await userEvent.click(within(root).getByRole("button", { name: "Tiny" })); // off again
    expect(within(root).getByRole("status").textContent).toBe("15 of 325 monsters");

    await userEvent.click(within(root).getByRole("button", { name: "Legendary" }));
    await userEvent.click(within(root).getByRole("button", { name: "Flies" }));
    expect(within(root).getByText("Ancient Red Dragon", { exact: true })).toBeTruthy();
    expect(within(root).queryByText("Tarrasque", { exact: true })).toBeNull(); // gargantuan and legendary, but doesn't fly
  });

  it("shows how many filters are on and clears them all at once", async () => {
    const root = await openSrd();
    await openFilters(root);
    await userEvent.type(search(root), "dragon");
    await userEvent.selectOptions(within(root).getByLabelText("Minimum challenge rating"), "10");
    await userEvent.click(within(root).getByRole("button", { name: "Legendary" }));
    expect(within(root).getByRole("button", { name: "Filters" }).textContent).toBe("3");

    await userEvent.click(within(root).getByRole("button", { name: "Clear all filters" }));
    expect(search(root).value).toBe("");
    expect((within(root).getByLabelText("Minimum challenge rating") as HTMLSelectElement).value).toBe("");
    expect(within(root).getByRole("button", { name: "Filters" }).textContent).toBe("");
    expect(within(root).queryByRole("status")).toBeNull();
  });

  it("filters by environment and automation tier", async () => {
    const root = await openSrd();
    await openFilters(root);
    await userEvent.click(within(root).getByRole("button", { name: "Full" }));
    expect(within(root).getByText("Goblin", { exact: true })).toBeTruthy();
    expect(within(root).queryByText("Aboleth", { exact: true })).toBeNull();

    await userEvent.click(within(root).getByRole("button", { name: "Full" }));
    const environment = within(root).getByLabelText("Environment") as HTMLSelectElement;
    const option = within(environment).getAllByRole("option")[1] as HTMLOptionElement;
    fireEvent.change(environment, { target: { value: option.value } });
    expect(within(root).getByRole("status").textContent).toMatch(/of 325 monsters$/);
    expect(within(root).getByRole("status").textContent).not.toBe("325 of 325 monsters");
  });

  it("keeps the folder permanent while filtering (still no rename/delete)", async () => {
    const root = await openSrd();
    await userEvent.type(search(root), "wolf");
    fireEvent.contextMenu(within(root).getByText("SRD Monsters"));
    expect(screen.queryByText("Delete folder")).toBeNull();
    expect(within(root).getByLabelText("Permanent folder")).toBeTruthy();
  });
});
