// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateTokenModal } from "@/components/modals/CreateTokenModal";
import type { Compendium } from "@/hooks/useCompendium";
import { useEncounterStore } from "@/store/encounter-store";

/** A new actor's creature type: type-restricted spells (Dominate Person, Charm Person) skip a creature with none. */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => cleanup());

const compendium = { status: "", setStatus: vi.fn(), importCreature: vi.fn() } as unknown as Compendium;

function renderModal() {
  render(<CreateTokenModal compendium={compendium} onClose={() => undefined} />);
  return {
    faction: () => screen.getByLabelText("Faction") as HTMLSelectElement,
    type: () => screen.getByLabelText("Type") as HTMLSelectElement
  };
}

async function createAndReadType(name: string) {
  const nameInput = screen.getByLabelText("Name");
  await userEvent.clear(nameInput);
  await userEvent.type(nameInput, name);
  await userEvent.click(screen.getByRole("button", { name: /create token/i }));
  return useEncounterStore.getState().encounter.definitions.find((d) => d.name === name)?.type;
}

describe("Create Token — creature type", () => {
  it("fills in humanoid for a party member, and clears it again for an enemy", async () => {
    const form = renderModal();
    expect(form.faction().value).toBe("enemy");
    expect(form.type().value).toBe("");

    await userEvent.selectOptions(form.faction(), "party");
    expect(form.type().value).toBe("humanoid");

    await userEvent.selectOptions(form.faction(), "enemy");
    expect(form.type().value).toBe("");
  });

  it("creates the party member as a humanoid", async () => {
    const form = renderModal();
    await userEvent.selectOptions(form.faction(), "party");
    expect(await createAndReadType("Brakka")).toBe("humanoid");
  });

  it("never overrides a type picked by hand, including Unspecified", async () => {
    const form = renderModal();
    await userEvent.selectOptions(form.type(), "fey");
    await userEvent.selectOptions(form.faction(), "party");
    expect(form.type().value).toBe("fey");

    await userEvent.selectOptions(form.type(), "");
    await userEvent.selectOptions(form.faction(), "enemy");
    await userEvent.selectOptions(form.faction(), "party");
    expect(form.type().value).toBe("");
  });
});
