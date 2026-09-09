// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationBadge } from "../src/components/ui/AutomationBadge";
import { Chip } from "../src/components/ui/ChipRow";
import { HpBar } from "../src/components/ui/HpBar";
import { PanelSearch } from "../src/components/ui/PanelSearch";
import { Toggle } from "../src/components/ui/Toggle";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("HpBar", () => {
  it("renders a clamped fill percentage", () => {
    const { container } = render(<HpBar current={9} max={12} />);
    const fill = container.querySelector("i") as HTMLElement;
    expect(fill.style.width).toBe("75%");
  });

  it("never exceeds 100% or drops below 0%", () => {
    const { container: over } = render(<HpBar current={50} max={10} />);
    expect((over.querySelector("i") as HTMLElement).style.width).toBe("100%");
    const { container: under } = render(<HpBar current={-5} max={10} />);
    expect((under.querySelector("i") as HTMLElement).style.width).toBe("0%");
  });

  it("goes red at or below half HP in auto mode, green above", () => {
    const { container: low } = render(<HpBar current={4} max={10} />);
    expect((low.querySelector("i") as HTMLElement).style.background).toContain("hp-red");
    const { container: high } = render(<HpBar current={6} max={10} />);
    expect((high.querySelector("i") as HTMLElement).style.background).toContain("hp-green");
  });
});

describe("AutomationBadge", () => {
  it('shows "reference-only" for manual-only, verbatim otherwise', () => {
    render(<AutomationBadge value="manual-only" />);
    expect(screen.getByText("reference-only")).toBeTruthy();
    render(<AutomationBadge value="full" />);
    expect(screen.getByText("full")).toBeTruthy();
  });
});

describe("PanelSearch", () => {
  it("reports typed input and fires onSubmit on Enter", async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(<PanelSearch value="" onChange={onChange} onSubmit={onSubmit} placeholder="Search" />);
    const input = screen.getByPlaceholderText("Search");
    await userEvent.type(input, "go");
    expect(onChange).toHaveBeenCalled();
    await userEvent.type(input, "{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("renders the action button only when a label is given", async () => {
    const onAction = vi.fn();
    render(<PanelSearch value="" onChange={() => {}} actionLabel="+ New" onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    expect(onAction).toHaveBeenCalled();
  });
});

describe("Chip", () => {
  it("reflects the active state and calls onClick", async () => {
    const onClick = vi.fn();
    render(<Chip label="Spells" active onClick={onClick} />);
    const chip = screen.getByRole("button", { name: "Spells" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalled();
  });
});

describe("Toggle", () => {
  it("is a switch that flips its value", async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Snap" />);
    const sw = screen.getByRole("switch", { name: "Snap" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
