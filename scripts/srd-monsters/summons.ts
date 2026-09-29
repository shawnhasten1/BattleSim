import type { FeatureDefinition, SummonActionDefinition, SummonOption } from "../../src/engine/types";
import type { MonsterContext, RawEntry } from "./context";
import { uniqueId } from "./context";
import { applyUsage } from "./usage";

/**
 * The SRD's "Variant: Summon Demon" / "Variant: Summon Mephits": "A balor has a 50 percent chance of summoning 1d8
 * vrocks, 1d6 hezrous, … or one goristro. A summoned demon appears within 60 feet, acts as an ally of its summoner,
 * and can't summon other demons. It remains for 1 minute, until it or its summoner dies…". Variants are opt-in, so
 * the action rides on an `optional` feature that grants it only once the DM switches it on.
 *
 * Options name other creatures by their plural. Those that aren't in the SRD (the balor's goristro) are dropped and
 * reported, not guessed at.
 */

/** Plurals the demons' texts use → the SRD slug they refer to. */
const PLURALS: Record<string, string> = {
  vrocks: "vrock", hezrous: "hezrou", glabrezus: "glabrezu", nalfeshnees: "nalfeshnee", mariliths: "marilith",
  dretches: "dretch", balors: "balor"
};
const SRD_SLUGS = new Set(Object.values(PLURALS));

export interface SummonVariant {
  feature: FeatureDefinition;
  dropped: string[];
}

export function parseSummonVariant(entry: RawEntry, ctx: MonsterContext): SummonVariant | null {
  if (!/^Variant: Summon (Demon|Mephits)/i.test(entry.name)) return null;
  const text = entry.desc.replace(/\s+/g, " ");
  const chance = Number(/(\d+) percent chance of summoning ([^.]+)\./i.exec(text)?.[1]);
  const list = /chance of summoning ([^.]+)\./i.exec(text)?.[1];
  if (!list || !chance) return null;

  const options: SummonOption[] = [];
  const dropped: string[] = [];
  for (const piece of list.split(/,\s*(?:or\s+)?|\s+or\s+/i).map((part) => part.trim()).filter(Boolean)) {
    const match = /^(one|a|an|\d*d\d+|\d+)\s+(.+)$/i.exec(piece);
    if (!match) {
      dropped.push(piece);
      continue;
    }
    const countText = match[1]!.toLowerCase();
    const count: SummonOption["count"] = /d/.test(countText) ? { dice: countText.startsWith("d") ? `1${countText}` : countText } : Number(countText) || 1;
    const name = match[2]!.toLowerCase();
    // "mephits of its kind" is the summoner's own kind.
    const slug = /of its kind$/.test(name) ? ctx.slug : PLURALS[name] ?? (SRD_SLUGS.has(name) ? name : undefined);
    if (!slug) {
      dropped.push(`${countText} ${name}`);
      continue;
    }
    options.push({ id: slug, definitionId: `srd:monster:${slug}`, label: slug === ctx.slug ? ctx.name : name.replace(/s$/, ""), count });
  }
  if (options.length === 0) return null;

  const demon = /Demon/i.test(entry.name);
  const action: SummonActionDefinition = {
    kind: "summon", id: uniqueId(ctx, "summon"), name: demon ? "Summon Demon" : "Summon Mephits", actionType: "action", range: 60,
    chance, options, choice: demon ? "pick" : "random",
    // "It remains for 1 minute" = 10 rounds; "can't summon other demons/mephits" = the summoned can't summon in turn.
    durationRounds: 10, maxGeneration: 1, automationSupport: "full"
  };
  applyUsage(action, entry, ctx);
  return {
    dropped,
    feature: {
      id: `${ctx.slug}-variant-${demon ? "summon-demon" : "summon-mephits"}`,
      name: entry.name, category: "trait", description: entry.desc, optional: true,
      grantedActions: [action], automationSupport: "full"
    }
  };
}
