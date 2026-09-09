# Bundled SRD library

`weapons.ts` and `spells.ts` are curated, offline lists of `WeaponDefinition` /
`SpellDefinition` records — mostly SRD 5.1 content plus a few magic-item
exemplars. They power the Actions-tab "Add ▸ From library" browser and the
drag-and-drop attach flow.

Nothing here is user-editable at runtime. Attaching an entry to a creature
**deep-clones** it and re-mints every id, so the creature's copy is fully
independent and freely editable afterwards.

## Adding an entry

1. Append a record to `SRD_WEAPONS` (`weapons.ts`) or `SRD_SPELLS` (`spells.ts`).
2. `id` must be `srd:weapon:<kebab-slug>` / `srd:spell:<kebab-slug>` and unique.
   `src/data/srd/index.ts` throws at load time if this is violated.
3. **Do not** set `id` on riders or `actionId` on a weapon — both are minted on
   attach. `action.id` on a spell is a placeholder; also re-minted.
4. Author damage with the canonical `dice` string (`"2d6"`, `"1d4+1"`). The
   `diceCount` / `diceSize` / `flatBonus` sugar is filled in on attach by
   `normalizeWeaponDefinition` / `normalizeSpellDefinition`.
5. Put the wielding stat modifier on a weapon's primary damage component
   (`abilityModifier`), except on `ability: "finesse"` weapons where it is
   resolved at attack time.
6. Spell save DCs: `dcFormula: { base: 8, ability: <iconic stat>, proficiency: true }`
   so the DC scales with the caster. Pick the spell's iconic spellcasting stat
   (Fire Bolt → `int`, Sacred Flame → `wis`, Eldritch Blast → `cha`); the DM can
   retune it after attaching.
7. `automationSupport` is authored to its final intended value. Engine execution
   of `riders`, `attackDelivery: "beams"`, aimed / self-origin areas, `scaling`
   and `upcast` arrives in the engine-resolvers phase; until then those fields
   round-trip and validate but are not yet resolved in play.
8. Run `npx vitest run tests/srd-library.test.ts` — every entry is validated
   against the engine schemas and checked for a clean attach.
9. Bump `SRD_LIBRARY_VERSION` in `index.ts`.

## Charges (limited-use weapon abilities)

A weapon with a spell-like `onHit` effect that is not usable at will carries a
`charges` pool:

```ts
charges: { id: "fear-strike", max: 1, recharge: "dawn" },
onHit: [{
  kind: "condition", when: "on-hit", condition: "frightened",
  save: { ability: "wis", dc: 15, onSuccess: "negates" },
  duration: { kind: "rounds", rounds: 10 },
  resourceCost: { resourceId: "fear-strike", amount: 1 }
}]
```

On attach the store namespaces `charges.id` to `<newWeaponId>:<id>`, rewrites the
matching rider `resourceCost.resourceId`, seeds `definition.resources[chargeId] =
max`, and tops up every existing combatant of that definition. `recharge` is
advisory metadata for now (there is no rest loop) — the pool is refilled from the
sheet's resource strip or a future rest action.

## Future metadata

If the library browser later needs facets that are not derivable from the engine
record (curated tags, blurbs), add a `Partial<Record<string, SrdMeta>>` sidecar
map keyed by id in `index.ts` — do **not** widen the engine types.

## Features (`features.ts`)

`SRD_FEATURES` is the third library type — plain `FeatureDefinition` records,
ids `srd:feature:<slug>`. Attaching one (`attachSrdFeature`) deep-clones it,
re-mints the feature id and every `grantedActions` id (`<featureId>-granted-N`),
points each granted `featureId` back at the fresh id, and seeds a resource pool
for any granted `resourceCost` whose id is a known pool (`rage`, `action-surge`,
`second-wind`, `bardic-inspiration`).

Authoring:
- **Activated** features carry their `activate-feature` (or a granted `attack` /
  `healing` / `utility`) in `grantedActions`. The sheet groups each granted
  action by its own `actionType`. A lingering effect goes in the granted
  `activate-feature`'s `condition.effects`; an instantaneous one (Action Surge's
  `extra-action`) goes on the feature's own `effects` (that's where
  `resolveActivateFeatureAction` looks).
- **Passive** features carry only `effects`.
- **Grants** features carry `grantedActions: [{ kind: "utility", actionType:
  "bonus", mode, … }]` (Cunning Action).
- Skip pure flavour — no damage / utility / economy impact, no entry.
