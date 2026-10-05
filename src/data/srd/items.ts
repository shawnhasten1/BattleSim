import type { ItemDefinition } from "@/engine";

/**
 * Bundled item library (ITEMS_PLAN.md §7): SRD 5.1 magic items and gear the engine can run, as plain `ItemDefinition`
 * records.
 *
 * Authoring contract (see `README.md`):
 * - `id` is `srd:item:<kebab-slug>`, unique across the file.
 * - A stack or charges is `supply: { id: "supply", size, unit }`, and every use that spends it names `"supply"`: the
 *   pool is renamed `item:<new item id>` on attach (`withItemPool`). Use ids are placeholders, re-minted on attach.
 * - A potion's use is drinking it: a heal or a buff aimed at itself, with `give` for what giving it to a creature within
 *   5 ft takes. In SRD 5.1, drinking or administering a potion takes an action.
 * - A potion's use carries the potion's own name, so the log and the AI's reasons read naturally.
 */

/** A Potion of Healing of some rarity: a stack of one, drunk or given for an action. */
function potionOfHealing(slug: string, name: string, dice: string, rarity: string): ItemDefinition {
  return {
    id: `srd:item:${slug}`,
    name,
    type: "potion",
    magical: true,
    description: `A ${rarity} potion. You regain ${dice.replace("+", " + ")} hit points when you drink it; whatever its potency, its red liquid glimmers when agitated. Drinking or administering a potion takes an action.`,
    supply: { id: "supply", size: 1, unit: "count" },
    give: { actionType: "action" },
    grantedActions: [{
      kind: "healing",
      id: "drink",
      name,
      actionType: "action",
      range: 0,
      healing: [{ dice }],
      targeting: { target: "self" },
      resourceCost: { resourceId: "supply", amount: 1 },
      automationSupport: "full"
    }],
    automationSupport: "full"
  };
}

export const SRD_ITEMS: readonly ItemDefinition[] = [
  // ── Potions of Healing ──────────────────────────────────────────────────────
  potionOfHealing("potion-of-healing", "Potion of Healing", "2d4+2", "common"),
  potionOfHealing("potion-of-greater-healing", "Potion of Greater Healing", "4d4+4", "uncommon"),
  potionOfHealing("potion-of-superior-healing", "Potion of Superior Healing", "8d4+8", "rare"),
  potionOfHealing("potion-of-supreme-healing", "Potion of Supreme Healing", "10d4+20", "very rare")
];
