/**
 * A short, stable fingerprint of what the builder wrote, so a rebuild can tell a record the DM edited from one it may
 * replace (plan D5). Two values that mean the same get the same fingerprint:
 * - object keys in any order, and `undefined` fields, don't count;
 * - the dice fields the engine derives from `dice` (`diceCount`, `diceSize`, `flatBonus`) don't count, since importing or
 *   loading an actor fills them in;
 * - an empty list is no list (an import gives a feature without granted actions `grantedActions: []`).
 */
const DERIVED = new Set(["diceCount", "diceSize", "flatBonus"]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined || DERIVED.has(key) || (Array.isArray(child) && child.length === 0)) continue;
      out[key] = canonical(child);
    }
    return out;
  }
  return value;
}

/** FNV-1a over the canonical JSON, as 8 hex digits. `undefined` (nothing there) has a fingerprint of its own. */
export function fingerprint(value: unknown): string {
  const text = value === undefined ? "<none>" : JSON.stringify(canonical(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
