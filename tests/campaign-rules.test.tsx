// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleEncounter, withItemRules, type EncounterSnapshot, type ItemDefinition, type SpellDefinition } from "@/engine";
import { findSrdItem, findSrdSpell } from "@/data/srd";
import { hasCounterspellers, hasPotions, parseCampaignRules, potionRulesInForce, ruleInForce, withCampaignRules, type CampaignRules as Rules } from "@/lib/campaign-rules";
import { CampaignRules } from "@/components/campaigns/CampaignRules";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * The campaign's rule on what counterspellers know (UPCASTING_AND_COUNTERSPELL_PLAN.md Phase 5): kept on the campaign,
 * written into an encounter's snapshot as it opens, so the engine reads it from the snapshot like any other rule and a
 * run carries the rule it ran under.
 */

const prisma = vi.hoisted(() => ({
  project: { findUnique: vi.fn(), update: vi.fn() },
  encounter: { findUnique: vi.fn(), findMany: vi.fn() }
}));
vi.mock("@/server/prisma", () => ({ prisma }));
vi.mock("@/server/require-user", () => ({ requireUserId: async () => "user-1" }));

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const store = () => useEncounterStore.getState();
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("the rules themselves", () => {
  it("are read from the database, anything unreadable being every default", () => {
    expect(parseCampaignRules("{\"counterspellReadsSpell\":false}")).toEqual({ counterspellReadsSpell: false });
    expect(parseCampaignRules(null)).toEqual({});
    expect(parseCampaignRules("not json")).toEqual({});
    expect(parseCampaignRules("{\"counterspellReadsSpell\":\"no\"}")).toEqual({});
  });

  it("go into an encounter's snapshot, leaving its other rules be", () => {
    const encounter = structuredClone(sampleEncounter);
    const off = withCampaignRules(encounter, { counterspellReadsSpell: false });
    // Every campaign rule is written in, at its default where the campaign doesn't set it.
    expect(off.rules).toEqual({
      ...encounter.rules, counterspellReadsSpell: false, potionUse: "action", potionActionHealsFull: false,
      grappled: "speed", stunned: "cant-move", surprise: "lose-turn"
    });
    expect(withCampaignRules(off, { counterspellReadsSpell: false })).toBe(off);
    expect(withCampaignRules(encounter, {}).rules.counterspellReadsSpell).toBe(true);
    expect(ruleInForce(off, "counterspellReadsSpell")).toBe("Counterspellers only see a spell being cast");
  });

  it("read the potion rules too, and refuse a setting that isn't one", () => {
    expect(parseCampaignRules(JSON.stringify({ potionUse: "drink-bonus", potionActionHealsFull: true }))).toEqual({ potionUse: "drink-bonus", potionActionHealsFull: true });
    expect(parseCampaignRules(JSON.stringify({ potionUse: "sometimes" }))).toEqual({});
  });

  it("write the potion rules into the snapshot and into every potion that follows them", () => {
    const encounter = carrying(structuredClone(sampleEncounter));
    const ruled = withCampaignRules(encounter, { potionUse: "bonus", potionActionHealsFull: true });
    expect(ruled.rules).toMatchObject({ potionUse: "bonus", potionActionHealsFull: true, counterspellReadsSpell: true });
    const potion = ruled.definitions.find((definition) => definition.id === "def-fighter")!.items![0]!;
    expect([potion.grantedActions![0]!.actionType, potion.give?.actionType, potion.fullWithAction]).toEqual(["bonus", "bonus", true]);
    expect(withCampaignRules(ruled, { potionUse: "bonus", potionActionHealsFull: true })).toBe(ruled);
    // Every default: an action, rolled.
    const plain = withCampaignRules(ruled, {});
    expect(plain.rules).toMatchObject({ potionUse: "action", potionActionHealsFull: false });
    expect(plain.definitions.find((definition) => definition.id === "def-fighter")!.items![0]!.grantedActions![0]!.actionType).toBe("action");
  });

  it("say what's in force in a few words, the full-healing rule only where it applies", () => {
    const say = (rules: Rules) => potionRulesInForce(withCampaignRules(structuredClone(sampleEncounter), rules));
    expect(say({})).toBe("Potions take an action");
    expect(say({ potionActionHealsFull: true })).toBe("Potions take an action");
    expect(say({ potionUse: "bonus", potionActionHealsFull: true })).toBe("Potions take a bonus action · an action instead heals a potion in full");
    expect(say({ potionUse: "drink-bonus" })).toBe("A bonus action to drink a potion, an action to give one");
    expect(ruleInForce({ rules: { ...sampleEncounter.rules, potionUse: "bonus" } }, "potionUse")).toBe("Potions take a bonus action");
  });

  it("are worth mentioning only where something carries a potion", () => {
    expect(hasPotions(sampleEncounter)).toBe(false);
    expect(hasPotions(carrying(structuredClone(sampleEncounter)))).toBe(true);
  });

  it("are worth mentioning only where something can counter a spell", () => {
    const encounter = structuredClone(sampleEncounter);
    expect(hasCounterspellers(encounter)).toBe(false);
    // A new definition, as an edit makes one: compiled actions are cached on the old.
    encounter.definitions[0] = { ...encounter.definitions[0]!, spells: [structuredClone(findSrdSpell("srd:spell:counterspell") as SpellDefinition)] };
    expect(hasCounterspellers(encounter)).toBe(true);
  });
});

describe("the API", () => {
  it("saves a campaign's rules, and refuses ones it can't read", async () => {
    const { PUT } = await import("../app/api/projects/[id]/route");
    prisma.project.findUnique.mockResolvedValue({ id: "c1", ownerId: "user-1", name: "Campaign", encounters: [], maps: [] });
    prisma.project.update.mockResolvedValue({ id: "c1", name: "Campaign", rulesJson: "{\"counterspellReadsSpell\":false}", maps: [], encounters: [] });
    const request = (body: unknown) => new Request("http://local/api/projects/c1", { method: "PUT", body: JSON.stringify(body) });
    await PUT(request({ rules: { counterspellReadsSpell: false } }), params("c1"));
    expect(prisma.project.update.mock.calls[0]![0].data).toMatchObject({ rulesJson: "{\"counterspellReadsSpell\":false}" });
    await expect(PUT(request({ rules: { counterspellReadsSpell: "no" } }), params("c1"))).rejects.toThrow();
    await expect(PUT(request({ rules: { somethingElse: true } }), params("c1"))).rejects.toThrow();
  });

  it("hands an encounter over with its campaign's rules, and the campaign page its rules with its name", async () => {
    const { GET: getEncounter } = await import("../app/api/encounters/[id]/route");
    prisma.encounter.findUnique
      .mockResolvedValueOnce({ project: { ownerId: "user-1" } })
      .mockResolvedValueOnce({ id: "e1", projectId: "c1", name: "Fight", snapshotJson: JSON.stringify(sampleEncounter), simulationRuns: [], project: { rulesJson: "{\"counterspellReadsSpell\":false}" } });
    const encounter = await (await getEncounter(new Request("http://local"), params("e1"))).json();
    expect(encounter.encounter.campaignRules).toEqual({ counterspellReadsSpell: false });
    expect(encounter.encounter.project).toBeUndefined();

    const { GET: getList } = await import("../app/api/projects/[id]/encounters/route");
    prisma.project.findUnique.mockResolvedValue({ id: "c1", name: "Campaign", ownerId: "user-1", rulesJson: null });
    prisma.encounter.findMany.mockResolvedValue([]);
    const list = await (await getList(new Request("http://local"), params("c1"))).json();
    expect(list.campaign).toEqual({ id: "c1", name: "Campaign", rules: {} });
  });
});

/** The sample fight, its fighter carrying a Potion of Healing as the library has it (an action, rolled). */
function carrying(encounter: EncounterSnapshot): EncounterSnapshot {
  const potion = { ...(structuredClone(findSrdItem("srd:item:potion-of-healing")) as ItemDefinition), id: "potion" };
  encounter.definitions = encounter.definitions.map((definition) => (definition.id === "def-fighter" ? { ...definition, items: [potion] } : definition));
  return encounter;
}

/** A fetch that answers the routes the store calls. */
function stubServer(rules: Rules, snapshot: EncounterSnapshot = sampleEncounter) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url === "/api/encounters/e1") return json({ encounter: { id: "e1", projectId: "c1", name: "Fight", snapshotJson: structuredClone(snapshot), campaignRules: rules } });
    if (url === "/api/projects/c1" && init?.method === "PUT") return json({ project: {} });
    if (url === "/api/projects/c1/encounters") return json({ campaign: { id: "c1", name: "Campaign", rules }, encounters: [] });
    if (url === "/api/projects") return json({ projects: [] });
    return new Response("{}", { status: 404 });
  }));
  return calls;
}

describe("in the store", () => {
  it("an encounter opened takes its campaign's rules", async () => {
    stubServer({ counterspellReadsSpell: false });
    await store().loadEncounter("e1");
    expect(store().encounter.rules.counterspellReadsSpell).toBe(false);
    expect(store().campaignRules).toEqual({ counterspellReadsSpell: false });
  });

  it("changing the campaign's rule reaches its open encounter at once; a batch run before keeps the rule it ran under", async () => {
    const calls = stubServer({});
    await store().loadEncounter("e1");
    expect(store().encounter.rules.counterspellReadsSpell).toBe(true);
    store().runBatch(2);
    await vi.waitFor(() => expect(store().batchSummary).toBeTruthy());
    expect(await store().setCampaignRules("c1", { counterspellReadsSpell: false })).toBe(true);
    expect(calls.find((call) => call.init?.method === "PUT")?.init?.body).toBe(JSON.stringify({ rules: { counterspellReadsSpell: false } }));
    expect(store().encounter.rules.counterspellReadsSpell).toBe(false);
    expect(store().batchSummary!.rules.counterspellReadsSpell).toBe(true);
  });

  it("an encounter opened has its potions take what its campaign's rule says, with no undo step for it", async () => {
    stubServer({ potionUse: "bonus", potionActionHealsFull: true }, carrying(structuredClone(sampleEncounter)));
    await store().loadEncounter("e1");
    const potion = () => store().encounter.definitions.find((definition) => definition.id === "def-fighter")!.items![0]!;
    expect([potion().grantedActions![0]!.actionType, potion().give?.actionType, potion().fullWithAction]).toEqual(["bonus", "bonus", true]);
    expect(store().undoStack).toEqual([]);
    expect(withItemRules(store().encounter)).toBe(store().encounter);
  });

  it("a potion added under the rule takes it at once, and the rule changed while it's open changes its potions", async () => {
    const calls = stubServer({ potionUse: "drink-bonus" });
    await store().loadEncounter("e1");
    store().attachSrdItem("def-fighter", "srd:item:potion-of-healing");
    const potion = () => store().encounter.definitions.find((definition) => definition.id === "def-fighter")!.items![0]!;
    expect([potion().grantedActions![0]!.actionType, potion().give?.actionType]).toEqual(["bonus", "action"]);
    store().runBatch(2);
    await vi.waitFor(() => expect(store().batchSummary).toBeTruthy());
    expect(await store().setCampaignRules("c1", { potionUse: "action" })).toBe(true);
    expect(calls.find((call) => call.init?.method === "PUT")?.init?.body).toBe(JSON.stringify({ rules: { potionUse: "action" } }));
    expect([potion().grantedActions![0]!.actionType, potion().give?.actionType]).toEqual(["action", "action"]);
    // The batch run before the change keeps the rule it ran under.
    expect(store().batchSummary!.rules.potionUse).toBe("drink-bonus");
  });

  it("another campaign's rule leaves the open encounter alone; a refresh brings in its own campaign's", async () => {
    stubServer({ counterspellReadsSpell: false });
    await store().loadEncounter("e1");
    useEncounterStore.setState({ encounter: { ...store().encounter, rules: { ...store().encounter.rules, counterspellReadsSpell: true } } as EncounterSnapshot });
    await store().setCampaignRules("c2", { counterspellReadsSpell: true });
    await store().refreshCampaignRules("c1");
    expect(store().encounter.rules.counterspellReadsSpell).toBe(false);
  });
});

describe("the campaign page's toggle", () => {
  it("is on by default, saves when switched, and goes back if the save fails", async () => {
    const seen: unknown[] = [];
    let ok = true;
    useEncounterStore.setState({ setCampaignRules: async (_id: string, rules: unknown) => { seen.push(rules); return ok; } } as never);
    let rules = {};
    const { rerender } = render(<CampaignRules campaignId="c1" rules={rules} onChange={(next) => { rules = next; }} />);
    const box = screen.getByRole("checkbox", { name: /Counterspellers know what's being cast and at whom/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    await userEvent.click(box);
    expect(seen).toEqual([{ counterspellReadsSpell: false }]);
    rerender(<CampaignRules campaignId="c1" rules={rules} onChange={(next) => { rules = next; }} />);
    expect((screen.getByRole("checkbox", { name: /Counterspellers know/ }) as HTMLInputElement).checked).toBe(false);

    ok = false;
    await userEvent.click(screen.getByRole("checkbox", { name: /Counterspellers know/ }));
    expect(rules).toEqual({ counterspellReadsSpell: false });
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't save/);
  });
});

describe("the campaign page's potion rules", () => {
  it("chooses what a potion takes; full healing for an action is greyed out until there's a bonus action to trade", async () => {
    const seen: unknown[] = [];
    useEncounterStore.setState({ setCampaignRules: async (_id: string, rules: unknown) => { seen.push(rules); return true; } } as never);
    let rules: Rules = {};
    const { rerender } = render(<CampaignRules campaignId="c1" rules={rules} onChange={(next) => { rules = next; }} />);
    const choice = screen.getByRole("combobox", { name: "Drinking or giving a potion takes" }) as HTMLSelectElement;
    expect(choice.value).toBe("action");
    const full = () => screen.getByRole("checkbox", { name: /heals in full/ }) as HTMLInputElement;
    expect(full().disabled).toBe(true);
    expect(full().checked).toBe(false);
    expect(screen.getByText(/no bonus action to trade/)).toBeTruthy();

    await userEvent.selectOptions(choice, "bonus");
    expect(seen).toEqual([{ potionUse: "bonus" }]);
    rerender(<CampaignRules campaignId="c1" rules={rules} onChange={(next) => { rules = next; }} />);
    expect(full().disabled).toBe(false);
    expect(screen.queryByText(/no bonus action to trade/)).toBeNull();
    await userEvent.click(full());
    expect(seen.at(-1)).toEqual({ potionUse: "bonus", potionActionHealsFull: true });

    // Back to the 2014 rule: the switch keeps its setting, but shows off and greyed out.
    rerender(<CampaignRules campaignId="c1" rules={{ potionUse: "action", potionActionHealsFull: true }} onChange={() => {}} />);
    expect(full().disabled).toBe(true);
    expect(full().checked).toBe(false);
  });

  it("are saved by the API, which refuses a setting that isn't one", async () => {
    const { PUT } = await import("../app/api/projects/[id]/route");
    prisma.project.findUnique.mockResolvedValue({ id: "c1", ownerId: "user-1", name: "Campaign", encounters: [], maps: [] });
    prisma.project.update.mockResolvedValue({ id: "c1", name: "Campaign", rulesJson: "{}", maps: [], encounters: [] });
    const request = (body: unknown) => new Request("http://local/api/projects/c1", { method: "PUT", body: JSON.stringify(body) });
    await PUT(request({ rules: { potionUse: "bonus", potionActionHealsFull: true } }), params("c1"));
    expect(prisma.project.update.mock.calls[0]![0].data).toMatchObject({ rulesJson: JSON.stringify({ potionUse: "bonus", potionActionHealsFull: true }) });
    await expect(PUT(request({ rules: { potionUse: "sometimes" } }), params("c1"))).rejects.toThrow();
  });
});
