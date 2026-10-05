# Items Plan: potions, scrolls, wands and worn magic items on the sheet

**Status:** built, Phases 0–6, on branch `items` (2026-10-05); not merged. D1, D2 and D6 were confirmed by the
user on 2026-10-05. The same day the user asked for D10: a healing potion used with an action instead of a bonus action
heals its full amount (§6). The other decisions in §10 take their recommended defaults unless changed. Where the build
differs from the plan below, "Built so far" says how.

A creature should be able to carry items, starting with healing potions. In a fight it uses them the way a player
would: it drinks one when it's about to drop, and it feeds one to a friend who is down. The encounter report should
show what they were worth. Today there is no such thing as an item. The nearest is a "focus" weapon with charges, which
reads as a weapon and can't be given to anyone else.

## Built so far: where it differs from the plan

**The model (Phases 0 and 2).**
- An item's kind is its `type` field, not `kind`: the ability editor tells an action from anything else by `"kind" in
  record`, and an item must not pass for one.
- A potion's give is a compiled copy, `<drink id>:give` (5 ft, `targeting.notSelf`); a full-amount use is another,
  `<id>:full`. Uses carry `item` meta (`ItemUseMeta`: id, name, type, whether it's used up, drink or give, full).
- The hotbar hides the Items tab when there's nothing in it.

**The AI (Phase 1, then commit 57830d4).**
- It drinks by the **chance of dropping** before its next turn, not by "danger ≥ HP". Each threat that can reach it has
  a chance to land (an attack's chance to hit; even odds for a save or a routine) and what it deals when it does
  (`Danger.hits`, `dropChance`). A drink keeps it up when it cuts that chance by 25 points or more (`KEEPS_IT_UP`), and
  is worth `stayingUpValue()` (three times `DOWN_VALUE`) per drop avoided. So two goblins' shortbows drop a fighter at
  5 HP even though together they're expected to deal less than 5.
- A zone or terrain it stands in isn't counted in the danger yet.
- With nothing able to reach it, a bloodied creature drinks whatever its potion takes: the slot has nothing better to do
  (the plan's row 4 said an action-cost potion wouldn't).
- A revival is told from the declaration's `item.targetDown`, so non-item events (and the golden logs) are unchanged.

**The table's potion rules (Phase 4).**
- `CAMPAIGN_RULES` entries are a `toggle` or a `choice`; a toggle can have `inapplicable(rules)`, which greys it out on
  the campaign page with the reason (full healing under the 2014 rule). `withCampaignRules` writes every rule into the
  snapshot, at its default when the campaign doesn't set it, then `withItemRules`.
- The store applies `withItemRules` in `normalizeEncounterVisuals`, so every commit, load and replace stamps potions.
  The item editor stamps its draft the same way as it's edited (`AbilityEditor`'s `settle`), so what it shows is what's
  saved.
- The editor's Use & cost reads "What using it takes: The campaign's rule | Its own". Following the rule, it says what
  the potion takes and keeps "Can be given to a creature within 5 ft" as the potion's own; its own timing shows the
  drink and give choices and the full-healing switch (greyed out when neither takes a bonus action).
- The AI rolls a heal out in full (`healingOutcomes`: every result of 2d4 + 2 at its chance), not just its average,
  when it works out the chance of dropping after a drink. That's what makes the full 10 worth more than the roll.
- The whole-turn choice is as planned (attack and drink rolled with the bonus action, or drink in full with the action
  and use the bonus action for anything but another potion). The worked examples in §6 used the old danger total; the
  built ones (`tests/items-rules.test.ts`) use the drop chance:
  - 4/52 next to an ogre (its club lands 55% of the time for 13): the full 10 clears it, the roll almost never does, so
    it drinks in full and doesn't attack. At 8/52 the roll keeps it up nearly as well: it attacks and drinks rolled.
    At 2/52 not even 10 clears the club: it attacks and drinks rolled.
  - Two adjacent orcs (each half the time for 9.5): it attacks and drinks rolled at every HP; the full amount cuts the
    drop chance by about 30 points at most, which isn't worth an attack.
  - A downed ally next to an orc gets the full 10 for the action (a roll would likely leave her to drop again); next to
    the ogre, the rolled one for the bonus action (the full 10 doesn't clear its club either), and the action attacks.
    The rolled give goes first, from where it stands, before any move for the attack.
- A turn drinks one potion: after drinking with the action, the bonus action doesn't drink again.
- Known simplification: each threat deals its average on a hit, so thresholds are sharp. Rolling out each threat's
  damage would be more accurate, and would make 3 more HP worth a little less.
- Play's potion button has the variants "Drink (bonus action)", "Give (bonus action)", "Drink · full 10 (action)" and
  "Give · full 10 (action)". The sheet row says "drink or give (5 ft): 7 (2d4 + 2) HP · bonus action · with an action:
  the full 10". The Combat panel says "Potions take a bonus action · an action instead heals a potion in full ·
  campaign rules", a batch's Ran with line the same, and its Items line "(0.6 with an action, for the full amount)".

**The library and Open5e (Phase 5).**
- The thrown flasks are named "Vial of Acid" and "Flask of Holy Water", so the log reads "throws a Vial of Acid"; the
  SRD's "Acid (vial)" still finds it (the offer matches names by their words, in any order).
- A wand's tiers aren't authored one by one. Its use is the library's spell at the wand's DC (`itemSpellUse`), and
  `upcast.byCharges` (new on `SpellUpcast`) makes the engine compile a copy per extra charge, a level higher each
  (`<use id>:charges-N`, up to the charges it holds and 9th level). The hotbar folds them into one button ("3 charges ·
  5th"), the log says "(Fireball at 5th level, 3 charges)", and the Necklace of Fireballs throws beads the same way.
- There's no spell picker for scrolls. `SRD_SPELL_SCROLLS` is a scroll of each of the 82 library spells, indexed with the
  items but listed only for a search with "scroll" in it; the Spell scroll recipe starts that search. A creature's own
  spell gets one too (`own-scroll:<spell id>`).
- `ItemDefinition.notSimulated` says what part of an item the engine doesn't run; the sheet marks it partial. The
  Potion of Speed is partial (+2 AC and advantage on Dexterity saves: a condition can only slow a creature, not double
  its speed), as are Growth (no size), Invisibility (attackers at −4; it doesn't end on an attack), the Bracers of
  Defense (armor and shields aren't checked) and the Brooch of Shielding (no magic missile immunity).
- Seven items are carried for reference until §9: Alchemist's Fire, a Healer's Kit, the Potions of Giant Strength and
  Flying, the Elixir of Health, Gauntlets of Ogre Power and the Amulet of Health.
- An Open5e item comes in as a reference-only item (`normalizeOpen5eItem`, its kind from Open5e's category), from the
  Compendium or from Add ability's "Search Open5e items" under Items. The SRD's twin is offered under the Abilities
  tab's resources, not on the row, and taking it keeps the item's id, pool and count (`swapInSrdItem`).
- A rider that only some creatures take says so on its row too ("+7 (2d6) radiant (fiend or undead only)").

**Foci (Phase 6).**
- `migrateDefinition` moves each focus weapon into `items` as a wand, its id, its pool's id (`<weapon id>:<charges
  id>`) and its uses' ids kept. `withItemPool` keeps a pool already namespaced to its item, so an edit doesn't move
  every token's count to a new pool.
- "Plays the same" holds for every roll, decision and the outcome; the declaration's wording and data change (an item's
  use says which item it is).
- The weapon JSON check refuses `attackType: "focus"` ("a focus or a wand is an item now"), since a commit would move it
  out from under the editor. The engine still compiles an unmigrated focus, for a snapshot run headless.
- `tests/focus-weapons.test.ts` became `tests/weapon-charges.test.ts` (a weapon's granted actions and charged riders)
  and `tests/items-foci.test.ts` (the migration, and what a focus's effects did, as a wand's).

## Summary

- **Items are a new list on the creature (Phase 0).** Each item is a stack of potions, a scroll, a wand, a flask, or a
  ring or cloak that is always working. It holds how many there are (or its charges), what using it does, and what it
  gives while carried.
- **Using an item is an ability the engine already runs.** A Potion of Healing is a heal. A Potion of Heroism is a buff
  with temporary HP. A vial of acid is a thrown attack. A Scroll of Fireball is a Fireball at the scroll's DC. No new
  resolvers are needed for any of these.
- **A potion is drunk or given.** Each potion gives two choices: drink it, or give it to a creature within 5 ft.
  Giving is the classic move of pouring a potion into a downed friend. The healing resolver already brings a downed
  creature back up.
- **The AI uses them like a player would (Phase 1).** It feeds a potion to a downed ally it can reach. It drinks one
  when it's likely to drop before its next turn, not at the first scratch. A bonus-action potion is drunk alongside the
  attack. Resource stance scales how readily it does either. Today's healing logic would drink at half HP instead of
  attacking, whether or not anything can reach it.
- **Counts behave like every other resource.** A stack is a resource pool: a fight spends it, Restart refills it, and a
  token can start with fewer. The resource list shows it next to spell slots and charges.
- **Items get their own group on the Abilities tab (Phase 2, D1).** They're added from the library or built in the
  ability editor, like every other ability.
- **Play shows them on the hotbar (Phase 3),** on an Items tab with how many are left and Drink and Give variants.
- **The report says what items did (Phase 3):** potions used per fight, downed allies brought back, and how often a
  creature went down still holding one.
- **How long a potion takes is the table's rule (Phase 4, D2).** It's a campaign rule: an action (2014 rules), a bonus
  action (2024 rules), or the common house rule of a bonus action to drink and an action to give.
- **A second campaign rule gives full healing for an action (Phase 4, D10).** Where a bonus action would do, a creature
  can spend its action instead to get a healing potion's full amount: a Potion of Healing heals 10 instead of 2d4 + 2.
  The AI weighs that against keeping its action for an attack.
- **The library covers the SRD items the engine can run (Phase 5).** That means potions, spell scrolls, flasks, wands
  and worn items. An Open5e item attaches as a reference item, and the matching SRD item is offered.
- **Wands and other foci move into items (Phase 6, D6),** so all magic items with charges live in one place.

What it looks like in a fight:

> Round 3. Mira is down. Kael moves 10 ft and gives her a Potion of Healing: she regains 7 HP and stands up.
> Round 4. Kael is at 9 HP with two orcs on him (≈13 damage likely before his next turn). He drinks a Potion of
> Healing as a bonus action and attacks.

## 1. What's there today

### Nothing is an item yet

- Nothing in `src/` models potions, inventory or consumables. (Grep: the only hits are SRD monster description text.)
- **The nearest thing is a focus.** The charge-tier work gave `WeaponDefinition` (types.ts ~1441) a third
  `attackType`, `"focus"`. A focus compiles no attack of its own (`weaponToActions`, combat.ts ~4843). It has
  `charges`, `grantedActions` that compile like a feature's (`compileExecutableActions` ~221) and `effects` that fold
  into `featureSources` (~5119). On attach, `prepareWeaponForAttach` (encounter-store.ts ~656) re-mints the granted
  ids, namespaces the pool to `<weaponId>:<id>`, seeds `definition.resources` and tops up the tokens.
- A potion could be faked as a focus with three charges. It would read as a weapon ("focus · 3 charges"), and it
  couldn't be given to another creature.

### Resources

- `definition.resources` is what every token of the creature starts with ("Full"). `combatant.resources` is what this
  token has left ("Left").
- `validateAndSpendAction` (combat.ts ~4699) spends an action's `resourceCost`.
- On the AI side, `canPayResource` (simulation.ts ~3067) filters out what the creature can't pay for.
  `resourceCostWeight` (~3101) prices a spend: a slot by its level, any other pool by its amount.
  `resourceStanceMultiplier` (~220) scales that price: ×3 conservative, ×1 balanced, ×0.15 liberal.
- `restartCombat` (encounter-store.ts ~1144) refills every token from `definition.resources`.
- On the sheet, `resourceRows` (`src/lib/actor-sheet/resources.ts`) lists every pool with Left and Full, and
  `withResourceSize` keeps sizes in step.

### Healing, and how the AI heals

- `resolveHealingAction` (combat.ts ~2184) heals one creature. A downed creature that gets above 0 is back up: its
  state becomes active, its death saves clear and it is no longer unconscious.
- `validateHealingTargeting` (~3946) accepts downed targets. A healing component's `abilityModifier` is optional, so a
  potion adds no modifier.
- A heal is only a spell when it has a `spellLevel`. Without one, `counterspellWindow` (~7232, via `castLevelOf`)
  never opens, so a potion can't be counterspelled.
- **The AI's healing choice.** `selectHealingAction(snapshot, actor, slot)` (simulation.ts ~1868) scores every heal
  against every wounded ally:
  - a downed ally starts at 95; anyone else at (fraction of HP missing) × 45;
  - plus the expected healing, capped at the HP missing;
  - minus weight × 3 × stance for what it spends, and distance ÷ 20;
  - plus 10 if the target is in range, 2 if the healer must move.
  - The best scorer wins if it scores 35 or more.
- **An action heal preempts the attack** in `takeAutomatedTurn` (~1210). A bonus-action heal competes with bonus
  attacks and buffs (`selectBonusCandidate` ~838).
  - So feeding a downed ally would already work, as soon as a potion is a heal that can target someone else.
  - So would over-drinking. An action-cost Potion of Healing (average 7) on a fighter at 26/52 scores 22.5 + 7 − 3 +
    10 = 36.5, so it drinks instead of attacking, whether or not anything can reach it.
  - Nothing estimates the damage a creature is likely to take before its next turn. `expectedDamageAgainst` (~3203)
    and `DOWN_VALUE` (18, ~3654) are the pieces to build that from.

### Buffs, and before the fight

- `buff` actions put a condition (and optional temporary HP) on self, one creature or several. Bless is approximated as
  a flat +2, the library's precedent for a d4.
- A `prepOnly` buff is put up before the fight with `togglePrepBuff` (store ~2624). It spends its cost and lasts the
  whole fight. The Combat panel and the Token tab list these through `prepBuffs` (`lib/actor-sheet/token.ts`).

### The sheet

- The Abilities tab (`ActionsTab.tsx`) shows the resource list, then `abilityList`'s groups
  (`lib/ability-editor/list.ts`): Traits, Actions, Bonus actions, Reactions, Spellcasting, Legendary actions, Lair
  actions, On death.
- Records are read and put back through `AbilityRef`s (`refs.ts`).
  - Lists: weapons, spells, features, traits, deathEffects, lairActions, actions, bonusActions, reactions.
  - A granted action lives under a weapon, a feature or a trait (`GrantingList`).
- Add (`AddAbility.tsx`) offers library weapons, spells and features, SRD monster abilities, and blank templates
  (`templates.ts`).

### Play, the report, saved data, Open5e and campaign rules

- **Play.** `hotbarFor` (`lib/play/hotbar.ts`) has six tabs: Attacks, Spells, Bonus, Features, Common, Reactions
  (`tabOf` ~144). A heal granted by a weapon lands under Features.
- **Report.** `report.ts` tallies `resourcesSpent` per creature from `ActionDeclared.resourceCost`.
  `formatResourceId` (~93) labels a pool by what follows its first colon, so a pool keyed by an item's uuid would read
  as gibberish.
- **Saved data.** `creatureDefinitionSchema` is `.passthrough()` (types.ts ~2179), so a new `items` field survives
  saves, imports and exports without a schema version bump. `migrateDefinition` (import-normalize.ts ~129) walks every
  `grantedActions` list.
- **Open5e.** The compendium already searches `v2/items/` (open5e-client.ts ~326). Dropping one on a creature attaches
  it as a manual-only reference *trait* (useCompendium.ts ~143).
- **Campaign rules.** `lib/campaign-rules.ts` has `campaignRulesSchema` and `CAMPAIGN_RULES`, on/off rules only.
  `withCampaignRules` writes them into `snapshot.rules` when an encounter is loaded or created, or the rule changes.

### What the engine can't do yet (this limits the library, §7 and §9)

- No ongoing "burning" damage: Alchemist's Fire.
- No stabilizing: Healer's Kit, Spare the Dying.
- No effect that sets an ability score: Potion of Giant Strength, Gauntlets of Ogre Power, Amulet of Health.
- No granted fly speed: Potion of Flying.
- No removing a condition: Elixir of Health.

## 2. Phase 0: the model and the engine

**Data shape** (`src/engine/types.ts`; names can change in the build):

```ts
/** Something a creature carries and can use, or that works while it's carried. */
export interface ItemDefinition {
  id: Id;
  name: string;
  description?: string;
  source?: SourceMetadata;
  /** How the sheet, the hotbar and the AI treat it. */
  kind: "potion" | "scroll" | "wand" | "thrown" | "worn" | "gear";
  /**
   * What its uses spend. `count`: a stack used up one at a time ("3 potions"). `charges`: the item stays (a wand).
   * Its pool is `item:<item id>`, sized in `definition.resources` like any other.
   */
  supply?: { size: number; unit: "count" | "charges"; regains?: WeaponCharges["recharge"] };
  /** What using it does: whole abilities, each with its own action type and a cost against the supply. */
  grantedActions?: ActionDefinition[];
  /** A potion can also be given to a creature within 5 ft, taking this. Absent: it can't be given. */
  give?: { actionType: "action" | "bonus" };
  /** Its drink and give follow the campaign's potion rule (Phase 4). Default on for potions. */
  followsTableRule?: boolean;
  /** Bonuses while it's carried (Ring of Protection: +1 AC and saves), as a focus's are. */
  effects?: FeatureEffect[];
  /** It needs attunement: unless attuned, it does nothing. */
  attunement?: { attuned: boolean };
  magical?: boolean;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}
// CreatureDefinition gains `items?: ItemDefinition[]`.
```

- It reuses `grantedActions` and `effects` on purpose. `spenders`, `withEveryAction`, `migrateDefinition`'s
  `withGrants`, `abilityRefs` and the editor's nested granted-ability mode all already walk those fields.
- A potion's effect is authored once, as a self-targeted heal or buff (the drink). The give is compiled from it (below).
- `CompiledActionMeta` (types.ts ~1406) gains `item?: { id: Id; name: string; consumes: boolean }`, stamped on every
  compiled item use. The AI, the hotbar, the log and the report then know an action is an item without parsing ids.
- `HealingActionDefinition` and `BuffActionDefinition` targeting gain `notSelf?: boolean`. A give can't target the
  giver.

**Compile** (`compileExecutableActions`, combat.ts ~221):
- An item works unless it needs attunement and isn't attuned. Each working item contributes:
  - its `grantedActions`, stamped with `item`;
  - for a potion with `give`, a give copy of each self-targeted heal or buff: `<useId>:give`, `targeting: { target:
    "single", notSelf: true }`, range 5, the same effect and cost, and `give.actionType`.
- `featureSources` folds working items' `effects` in, beside `weaponSources`.
- Item uses are never multiattack swings, because throwing acid is an action of its own (`swingCandidates`). The sheet's
  pickers (multiattack step, legendary "uses its…", `LimitPicker`) leave them out, as they leave out upcast copies.
- An item use is a spell only when it carries a `spellLevel`: a scroll's spell or a wand's. That spell can then be
  counterspelled, and it reads as a spell to `spellsOnly` effects. A potion never is one.
- It doesn't cost a slot, so `spellUpcastVariants` makes no copies of it.

**Pools.**
- `prepareItemForAttach` (store, sibling of `prepareWeaponForAttach`) does three things:
  - it re-mints use ids (`<itemId>-use-N`);
  - it rewrites a library entry's placeholder cost (`resourceId: "supply"`) to `item:<itemId>`;
  - it seeds `definition.resources` with the supply's size and tops up existing tokens.
- `withInsertedAbility` (new item) and `replaceAbilityRecord` (resized supply) go through it too, so a hand-built item's
  stack works the way a library one does. This avoids repeating the custom-weapon charge bug the charge-tier plan found.
- Restart refills stacks from Full, as it refills everything (D5).

**Log.**
- `declareAction` writes `item: { id, name, left }` into `ActionDeclared`.
- Messages say what happened: "Kael drinks a Potion of Healing", "Kael gives Mira a Potion of Healing", "Vex reads a
  Scroll of Fireball", "Bo throws a vial of acid at the troll".

**Saved data.** `creatureDefinitionSchema` lists `items: z.array(z.any()).optional()` beside `weapons`.
`migrateDefinition` walks `items[].grantedActions`. There's no version bump: the field is new and optional.

**Tests** (new `tests/items.test.ts`):
- A potion compiles a drink (self) and a give (`:give`, 5 ft, not self). A potion without `give` compiles only the
  drink.
- Drinking spends one from the stack. At none left, `validateAndSpendAction` refuses it.
- Giving it to a downed ally 5 ft away brings them up. At 10 ft it's refused, and the giver can't target itself.
- A potion opens no Counterspell window. A scroll's spell does, at the scroll's level.
- An item needing attunement does nothing until attuned: no uses, no effects.
- A Ring of Protection's +1 AC and saves reach `effectiveArmorClass` and saving throws.
- A thrown flask is never picked as an Extra Attack swing.
- `migrateDefinition` leaves an item-free creature untouched (same object).
- The golden Auto Run logs are unchanged.

## 3. Phase 1: the AI uses them

**What an item costs to use** (`resourceCostWeight`):
- A consumed use (a potion, a flask, a scroll) weighs 2. It's gone for good, where a slot or a charge comes back after
  a rest.
- A scroll weighs at least its spell's level, so a Scroll of Fireball is never cheaper than a 3rd-level slot.
- A wand's charge weighs 1.
- Stance scales all of these as it does everything else.

**Danger: `dangerBeforeNextTurn(snapshot, actor)`.** The damage this creature can expect to take before its next turn.
- Every active hostile gets one turn before then. For each hostile that can reach it (its speed plus its best attack's
  reach or range), add its best `expectedDamageAgainst` this creature.
- Add a zone or terrain it stands in that will hurt it first.
- It reads distance the way the AI's other range checks do. Walls are handled where the AI already prices a path
  cheaply, and otherwise skipped (v1 may overcount behind walls; the tests pin which).
- Pure, logged in the decision's reasons, and reusable later (Dodge, retreat).
- It's only computed for a creature holding a drink it could use, so batches without items cost nothing extra.

**Drinking** (a new `selectItemDrink`; `selectHealingAction` leaves self-drinks to it):
- **It drinks when it's in danger:** it's likely to drop before its next turn, and the potion would keep it up
  (danger ≥ HP, and danger < HP + the potion's average). That's worth `DOWN_VALUE` plus the HP it restores, minus the
  price.
- **Bloodied, it drinks only when the slot has nothing better to do:**
  - An action-cost drink competes with the turn's offensive plan on score, the way a buff does today.
  - A bonus-action drink competes with the other bonus candidates (`selectBonusCandidate`).
- **Stance:**
  - Conservative drinks only in danger.
  - Liberal also drinks whenever the heal won't be wasted (missing HP ≥ the potion's average) and the slot has nothing
    better to do.
- A buff potion (Heroism, Invulnerability, Resistance) goes through `selectBuffAction` as a self buff, priced as an
  item. It competes with the attack and is skipped once it's already up.

**Giving.**
- A give to a downed or incapacitated ally stays in `selectHealingAction`, scored as today's downed-ally heal (95 + …).
  It moves into range first. A conscious ally can drink its own, so the AI doesn't give to one (Play can).
- Whoever comes first in initiative with a potion and a path does it.
- A heal that already reaches beats a walk to give one (in range +10 against +2): a cleric's Healing Word from 40 ft
  beats the rogue's walk-and-give.

**Other items** need no new selection.
- A thrown flask is an `attack` in `selectOffensivePlan`, priced as an item. It's thrown only when it beats the weapon
  by more than the flask's price.
- A scroll or a wand's spell is chosen like any spell of its shape.

**Log.** Every item decision says why: "Kael drinks a Potion of Healing: 9 HP left, ≈13 damage likely before his next
turn (2 orcs in reach)", or "Kael gives Mira a Potion of Healing: she's down, 10 ft away".

**Worked examples.** These are at `balanced`, with a Potion of Healing (average 7) and the fighter's attack worth ≈12.
The constants are tuned in this phase; the tests lock the decisions, not the numbers.

| Situation | Potions take an action | Potions take a bonus action |
|---|---|---|
| 40/52 HP, one orc adjacent (danger ≈6) | Attacks | Attacks, doesn't drink |
| 9/52, two orcs adjacent (danger ≈13) | Drinks (18 + 7 − 2 beats 12) | Drinks and attacks |
| 20/52, one orc adjacent (danger ≈6) | Attacks (7 − 2 loses to 12) | Drinks (nothing better for the bonus) and attacks |
| 9/52, nothing can reach it before its next turn | Doesn't drink | Drinks (bloodied, bonus has nothing better) |
| Full HP, ally downed 20 ft away, holds a potion | Moves and gives it | Moves, gives it, attacks if in reach |
| Row 3 at `conservative` | Attacks | Attacks, doesn't drink |
| A cleric holding a potion and Healing Word (60 ft); ally downed 30 ft away | Casts Healing Word: it reaches, the potion needs a walk | Same |

**Tests** (`tests/items-ai.test.ts`):
- Each row above is a test.
- Plus:
  - an enemy bandit captain with a potion drinks it when surrounded (items work for monsters too);
  - a creature with no potions left never tries;
  - a downed ally gets a potion from the first ally whose turn it is;
  - the danger estimate for two adjacent orcs equals the sum of their expected damage;
  - a thrown flask loses to a better weapon and wins against a troll whose regeneration it would stop.
    That last one only if regeneration suppression is already scored; otherwise it's a noted gap, not a test.
- The golden logs are unchanged: no fixture carries items, and every change is gated on the `item` meta.

## 4. Phase 2: the sheet

**Where items show (D1, recommended): an Items group on the Abilities tab**, after Spellcasting, in statblock order. The
2024 statblocks' "Gear" line is the same idea. Everything a creature can use stays on one tab, with the same editor and
the same Add.

```
ITEMS                                                  attuned 1 of 3
 ● Potion of Healing       2 of 3      drink or give (5 ft): 2d4 + 2 HP · action
 ● Scroll of Fireball      1           3rd level · DC 15 · 8d6 fire, 20-ft sphere
 ● Wand of Magic Missiles  7 charges   Magic Missile (1 charge; +1 level per extra)
 ● Ring of Protection      attuned     +1 AC and saving throws
 ○ Potion of Giant Strength  1         Strength 21 for an hour — reference only: set it on Stats
```

**Rows** (`abilityList`).
- A new group, `items`, with rows from a new `itemRow`. The count chip is "2 of 3" (Left of Full on a token, Full on
  a creature) or "7 charges". Worn items show "attuned" or warn "not attuned: does nothing".
- The group note shows "attuned N of 3" when anything needs attunement.
- The row menu has Duplicate and Delete. Move to… doesn't apply.
- `refs.ts` gains the `items` list, and `items` as a `GrantingList`. `ITEM_TYPES` and `DefinitionItemType` gain
  `item`.

**Resource list.** Stacks and charges are pools (D5), so they're listed with Left and Full under their item's name
(new kind `item`). That's where a token's starting count is set: "this bandit has 1, the captain 3".
`withResourceSize` keeps `supply.size` in step, as it keeps `charges.max`.

**Add.**
- The library search gets items (`SrdEntryKind` `"item"`). Phase 2 ships the four healing potions; Phase 5 adds the rest.
- "Start from scratch" offers Potion (a heal or a buff), Scroll (pick a spell), Wand (charges and spells), Thrown
  flask, Worn item (bonuses while carried) and Other.

**The item editor** (record type `item` in the ability editor):
- **Item:** name, kind, magical, description.
- **How many / Charges:** the size. Charges also take "regains … at dawn", kept for reference: there's no rest in a
  fight.
- **Using it** (potions): "Drinking takes: [the campaign's rule (action) ▾ | Action | Bonus action]" and "Giving it to
  a creature within 5 ft: [the campaign's rule ▾ | Action | Bonus action | Can't]". The campaign's rule is an option
  from Phase 4 on. Until then, it's a plain choice.
- **What it does:** its uses, through the nested granted-ability editor features already use. Each kind starts from a
  recipe: Heal, Buff, Thrown attack, Cast a spell.
- **While carried:** bonuses (`FeatureEffectCards`). **Attunement:** "Needs attunement", "Attuned".
- **Warnings** (`abilityWarnings`):
  - a potion that does nothing;
  - needs attunement but isn't attuned;
  - more than 3 attuned (a warning, not a block: D7);
  - a scroll above the creature's caster level (the reading check isn't simulated);
  - a stack of 0.

**Elsewhere on the sheet.**
- The statblock text (`statblockFor`) gets an item line.
- The Token tab's "What the AI will use" lists items with their rule: "drinks when likely to drop; feeds downed
  allies".
- The header's automation count counts partial items.
- The JSON view works for items, as for everything else.

**Docs.** The Docs page gets an Items section, next to Spells and Features.

**Tests.**
- `tests/ability-list.test.ts` (the Items group and its rows).
- `tests/actor-sheet-resources.test.ts` (item pools, sizes in step).
- An `items-tab` component test through `tests/helpers/abilities-tab.ts`: add a library potion, build each kind from
  scratch, edit the count, attune and un-attune.
- The round-trip: an unedited save is a no-op (`ability-roundtrip`).

**Browser check.** Build each item kind from blank, and set every control on its own
(feedback: verify each toggle, not only data that's already there).

## 5. Phase 3: Play and the report

**Hotbar.**
- `HOTBAR_TABS` gains Items. `tabOf` sends anything with `item` meta there.
- `VARIANT_SUFFIX` folds `:give` into its drink's button. The variants read "Drink" and "Give".
  - Give aims at allies within 5 ft, downed ones included, never the user.
- The button shows "×2" left. At none left it's greyed out, saying "None left" (from `actionProblem`'s refusal).
- A wand's charge tiers fold into chips, as slots do ("1 charge · 3 darts", "2 charges · 4 darts").

**Before the fight.**
- A potion whose effect outlasts a fight is listed with the prep buffs on the Combat panel and the Token tab: "Drank
  it before the fight". Its effect must last 10 minutes or more (Heroism, Resistance).
- Ticking it spends one from the stack and puts the effect up for the fight. That's `togglePrepBuff` generalised to
  item uses, and Restart clears it.

**Report** (`report.ts`, `BattleReport.tsx`):
- **Items used, per creature:** listed by item name, not pool id: "Potion of Healing ×1.2 a fight". It reads `item` from
  `ActionDeclared`.
- **For the encounter:** "Potions: 2.1 a fight · got a downed ally up in 38% of fights".
- **Went down holding one:** how often a creature dropped with a healing potion it never used. This tells the DM that
  the AI or its stance held back too much.

**Tests.**
- `tests/play-*.test.ts`: the hotbar's Items tab, Drink and Give, give aiming and none left.
- An undo of a drink restores the stack.
- The report's tallies from a seeded fight. The prep toggle spends and refunds.
- **Browser:** Step, Auto Run, Batch and Play each use a potion. All four reach `takeAutomatedTurn`, but this codebase
  doesn't guarantee they share everything, so check them all.

## 6. Phase 4: the table's potion rules

**The rule.** `CAMPAIGN_RULES` gets its first rule that isn't on/off, `potionUse`, with three settings:

- **Action (2014 rules).** Both drinking and giving take an action. This is the default, and the SRD 5.1 the library
  follows.
- **Bonus action (2024 rules).** Both take a bonus action.
- **Drink: bonus action; give: action.** The common house rule.

`campaignRulesSchema` and the campaign page's control grow to allow a choice, not just a toggle.

**How it reaches the potions.**
- The engine only ever reads concrete action types, so a run, a saved run and an exported encounter carry the timing
  they were played with (AGENTS.md §7).
- The store writes the rule into every potion that follows it (`followsTableRule`), with `withItemRules(snapshot,
  rules)`. That sets the drink uses' `actionType` and `give.actionType`.
- It runs in `commitEncounter`, which every edit passes through, and on load and rule change. So a potion follows the
  rule however it arrived: a library add, a pasted actor, an imported JSON, or a creature dragged in from the Actors
  panel.
- It's idempotent and makes no undo step on its own.
- A potion set to its own timing is left alone. The editor says "the campaign's rule (bonus action)" or "its own:
  action".

**Shown where it matters.**
- The Combat panel's run settings: "Potions: bonus action · campaign rule", linking to the campaign page.
- The batch report header.
- The Docs page's campaign rules.

**Tests.**
- `withItemRules` sets potions that follow it and leaves the rest alone.
- Loading an encounter applies its campaign's rule.
- Changing the rule while it's open updates its potions.
- A run started before the change keeps its timing.
- A second `commitEncounter` with nothing new changes nothing.

### Full healing with an action (D10, asked for 2026-10-05)

A second campaign rule, off by default: **"Using an action instead of a bonus action, a healing potion heals its full
amount."** A Potion of Healing heals 2d4 + 2 with a bonus action, or the full 10 with an action. Greater heals 20,
Superior 40 and Supreme 60.

**Where it applies (D11).** The full amount is what a creature gets for spending its action where a bonus action would
do. So it only applies where the potion rule offers a bonus action:

| Potion rule | Drinking | Giving (5 ft) |
|---|---|---|
| Action (2014) | Action, rolled. The switch is greyed out: "Potions already take an action." | Action, rolled |
| Bonus action (2024) | Bonus action, rolled; **or an action, the full amount** | Bonus action, rolled; **or an action, the full amount** |
| Drink: bonus action; give: action | Bonus action, rolled; **or an action, the full amount** | Action, rolled. Giving always takes an action under this rule, so there's no bonus action to trade |

- It covers potions that heal with dice: the four Potions of Healing, and any homebrew healing potion. It doesn't cover
  a buff potion (Heroism's 10 temporary HP is already a fixed number), or the healing spell on a scroll or a wand.
- A potion that heals a fixed amount gets nothing from it: its full amount is what it always heals.
- A potion with its own timing (D2's opt-out) doesn't follow the campaign. Its editor has the same switch.

**Engine.** The engine still never reads the campaign.
- `ItemDefinition` gains `fullWithAction?: boolean`. `withItemRules` writes it onto potions that follow the table's
  rule, in the same pass that writes their timing.
- For each bonus-action heal such a potion has (the drink, and the give copy), the compiler adds an action copy,
  `<id>:full`. It has `actionType: "action"`, the same cost, and each healing component's dice written as their
  maximum: "2d4+2" becomes "10", worked out with the dice parser. An ability modifier stays as it is.
- The copy just heals 10, so everything that reads healing reads 10 without knowing about the rule: the resolver, the
  AI's `averageHealing`, the hotbar preview and the statblock text.
- The log says so: "Kael drinks a Potion of Healing with his action: the full 10 HP" (`full: true` on the event).

**AI.** With both copies, the choice covers the whole turn, not one slot. It compares:
- attacking with its action and drinking (rolled) with its bonus action, and
- drinking (the full amount) with its action, then using its bonus action for whatever else is best.

The danger estimate (Phase 1) decides. If the rolled average keeps it up, it drinks with its bonus action and attacks.
If only the full amount keeps it up, it gives up the attack for it, as long as staying up is worth more. Giving to a
downed ally works the same way, using the ally's danger: give with the bonus action and still attack, unless the ally
would drop again on the average but not on the full amount.

Worked examples (balanced, the 2024 rule with this rule on, a Potion of Healing averaging 7 with a full amount of 10,
an attack worth ≈12):

| Situation | Choice |
|---|---|
| 9/52, two orcs adjacent (danger ≈13) | 9 + 7 = 16 clears 13: drinks with the bonus action (rolled) and attacks |
| 5/52, the same two orcs | 5 + 7 = 12 doesn't clear 13, but 5 + 10 = 15 does: drinks with the action for the full 10, and doesn't attack |
| 5/52, danger ≈20 | Neither clears it, so the potion can't keep it up: it attacks, and drinks with the bonus action (bloodied, nothing better for the bonus) |
| Ally downed 5 ft away, one goblin next to it (ally's danger ≈5) | Gives with the bonus action (7 clears 5) and attacks |
| Ally downed 5 ft away between two orcs (ally's danger ≈9) | Gives with the action for the full 10, since 7 wouldn't keep the ally up |

**Play.** The potion's button gets the extra variants: "Drink · bonus · 2d4 + 2", "Drink · action · 10", "Give ·
bonus · 2d4 + 2" and "Give · action · 10". `VARIANT_SUFFIX` folds `:full`. The bonus action is the default.

**Sheet.** The row says both: "drink or give (5 ft): 2d4 + 2 HP as a bonus action, or the full 10 as an action". The
potion's editor says "Using an action instead: the full 10 (campaign rule)".

**Campaign page.** The switch sits under the potion rule. Under the 2014 rule it's greyed out, with the reason.
`CAMPAIGN_RULES` gains an "applies when" check for a rule that depends on another one. The Combat panel line reads
"Potions: bonus action · an action heals in full · campaign rules".

**Report.** "Potions: 2.1 a fight, 0.6 of them with an action for the full amount", so the DM can see what the rule
changes.

**Tests.**
- Compile under each potion rule with this rule on:
  - 2024: four uses (drink and give, each a rolled bonus action or a full-amount action);
  - the house rule: three (a rolled bonus-action drink, a full-amount action drink, a rolled action give);
  - 2014: two, both rolled.
  - With the rule off, there are no `:full` copies.
- A `:full` drink heals exactly 10, spends one potion, uses the action and logs `full: true`.
- A fixed-amount healing potion gets no copy.
- `withItemRules` writes `fullWithAction` only onto potions that follow the table's rule, and running it twice changes
  nothing.
- Each worked example above is a test. The golden logs are unchanged.
- Browser: turn the rule on from the campaign page, check it's greyed out under the 2014 rule, and drink both ways in
  Play.

## 7. Phase 5: the library and Open5e

`src/data/srd/items.ts` (`SRD_ITEMS`, ids `srd:item:<slug>`). It's indexed and frozen like the weapons, attached by
`attachSrdItem`, and covered by `tests/srd-library.test.ts` and the README.

| Works with the engine as it is | Items |
|---|---|
| Healing (Phase 2) | Potion of Healing 2d4 + 2, Greater 4d4 + 4, Superior 8d4 + 8, Supreme 10d4 + 20 |
| Buff potions | Heroism (10 temporary HP and Bless's +2, 1 hour); Invulnerability (resistance to all damage, 1 minute); Resistance (one type chosen on the item, 1 hour) |
| Partly simulated, marked ◐ | Growth (the extra 1d4 damage; not the size); Invisibility (the condition; it doesn't end on an attack unless the engine already does that); Speed (AC and speed; no extra action) |
| Thrown | Acid (vial): a ranged improvised attack, 20/60 ft, 2d6 acid. Holy Water: the same, 2d6 radiant against fiends and undead only (`restrictToCreatureTypes`; check that a zero-damage base attack logs sensibly) |
| Spell scrolls | One "Spell scroll" entry that asks for a spell (from the library or the creature's own), and makes "Scroll of <spell>": the spell's action at the scroll's numbers (DC 13 / +5 up to 2nd level, 15 / +7 for 3rd–4th, 17 / +9 for 5th–6th, 18 / +10 for 7th–8th, 19 / +11 for 9th; D8), `spellLevel` set, costing one scroll |
| Wands | Magic Missiles (7 charges, 1 per level), Web (DC 15), Fireballs (DC 15, 1 charge at 3rd, +1 level per extra), Lightning Bolts. One use per charge tier, folded on the hotbar. Each says "regains 1d6 + 1 at dawn" for reference. Attunement where the SRD asks for it |
| Worn | Ring of Protection, Cloak of Protection (+1 AC and saves), Bracers of Defense (+2 AC; "no armor or shield" is the DM's call), Brooch of Shielding (resists force), Ring of Resistance |
| Beads | Necklace of Fireballs: a stack of beads, each a 3rd-level Fireball (DC 15), thrown one at a time |

Needs §9 first: Alchemist's Fire, Healer's Kit, Potion of Giant Strength, Gauntlets of Ogre Power, Amulet of Health,
Potion of Flying and Elixir of Health. Until then they're reference-only items, so the DM can still carry them.

**Open5e.**
- Dropping an Open5e item on a creature makes a reference-only *item* (its text, source document and import time kept)
  instead of a trait.
- If an SRD library item has the same name, the row offers it: "The SRD's Potion of Healing is simulated. Use it." It's
  offered, never applied silently, as the upcast offer is. Two same-named items from different source documents stay
  separate (AGENTS.md §3).
- Open5e weapons still attach as weapons.

**Audit test.** Every library item validates, attaches cleanly, and compiles at the automation level it claims. Every
potion's healing dice match the SRD text.

## 8. Phase 6: wands and foci move into items (if D6)

- On load, `migrateDefinition` moves every `attackType: "focus"` weapon into `items` as a `wand`. Its `charges` become
  the supply and its `grantedActions` and `effects` come across as they are.
- Ids and pool ids are kept, so multiattack and legendary references and every token's count survive.
- The weapon editor loses its Focus kind. A staff that is also a weapon (Staff of Fire as a quarterstaff) stays a
  weapon with granted actions: "a weapon is something you attack with".
- `tests/focus-weapons.test.ts` moves to items. The round-trip and SRD tests stay green.
- A saved encounter with a focus loads with the focus in Items and plays the same: same seed, same log.

## 9. Later: engine additions that unlock more items

Each one is small and separate, and each turns reference items into simulated ones:

- **Burning:** a condition that deals damage at the start of the bearer's turn and ends when it spends an action on a
  DC 10 Dexterity check. The AI must value putting it out. This unlocks Alchemist's Fire.
- **Stabilize:** an effect that makes a dying creature stable. This unlocks Healer's Kit and Spare the Dying, and gives
  the AI a cheap option for a downed ally with no healing.
- **Set an ability score while it works:** "Strength becomes 21", read wherever the engine reads ability scores. This
  unlocks Giant Strength, Gauntlets, Belts, Amulet of Health and Headband of Intellect.
- **Grant a speed:** a fly speed for a duration. This unlocks Potion of Flying, plus spells like Fly.
- **Remove conditions:** unlocks Elixir of Health and Lesser Restoration.

## 10. Decisions (recommended defaults)

| | Question | Recommended | Alternative |
|---|---|---|---|
| D1 | Where items show on the sheet | **Confirmed:** an Items group on the Abilities tab (after Spellcasting); counts also in the resource list | A fourth tab, Items, as an inventory |
| D2 | How long using a potion takes | **Confirmed:** a campaign rule: Action (2014, default) / Bonus action (2024) / Drink bonus, give action; a potion can opt out | Set on each potion only; library potions take an action |
| D3 | Drink and give | One potion compiles both; give reaches a creature within 5 ft, never the giver | Author each use by hand |
| D4 | When the AI drinks | When it's likely to drop before its next turn; when bloodied, only if the slot has nothing better; always worth feeding a downed ally in reach | Today's healing threshold (drinks from about half HP) |
| D5 | What a count is | A resource pool: a fight spends it, Restart refills it, each token's starting count can differ | A separate inventory state |
| D6 | Wands and other foci | **Confirmed:** move them into items (Phase 6, migrated; the weapon editor loses Focus) | Leave them as focus weapons (the 2026-09-11 choice, made before items existed) |
| D7 | Attunement | Honoured: an unattuned item does nothing; more than 3 attuned is warned, not blocked | Ignored |
| D8 | A scroll's numbers | The scroll's DC and attack bonus by level (the rules) | The reader's own |
| D9 | Open5e items | A reference item, with the SRD item offered when the names match | Today's reference trait |
| D10 | Full healing for an action | **Asked for (2026-10-05):** a campaign rule, off by default: using an action instead of a bonus action, a healing potion heals its full amount | Potions are rolled however they're used |
| D11 | Where D10 applies | Only where the potion rule offers a bonus action: under the house rule a give (always an action) is rolled, and under the 2014 rule it changes nothing | Any use with an action heals in full: under the 2014 rule every healing potion would, and so would every give under the house rule |

## 11. Out of scope

- **Handing items between creatures** during a fight, or using a downed creature's own potions. Giving a potion means
  pouring it, not trading it.
- **Inventory bookkeeping:** weight, encumbrance, gold, containers, shopping, identifying, curses. Curses can be
  reference text.
- **Carrying the count from one fight to the next.** Each encounter starts from its own setup, as every resource does.
  Campaign management is a non-goal (AGENTS.md §18).
- **Weapons and armor as inventory.** Weapons stay where they are, and AC stays a number on Stats. Magic armor's +1 can
  be a worn item's AC bonus.
- **Ammunition counts.**
- **Recharging at dawn or on a rest.** It stays reference, as charges do today.
- **Spell scroll restrictions:** whether the spell is on the reader's class list, and the check to read one above your
  level. The DM gives scrolls to creatures that can read them, and the sheet warns (Phase 2).
- **Object interactions:** a free draw or stow, which hand holds what.

## 12. Risks and order of work

- **Batch numbers and golden logs.** No fixture carries items, and every AI change is gated on the `item` meta, so
  today's batches and the golden Auto Run logs must not move. Don't add items to `fixtures.ts`'s def-fighter,
  def-archer or def-goblin: about 30 test files use them as a blank slate. Tests build their own creature.
- **The danger estimate is new AI code.** It's pure and tested on its own, and only computed for creatures holding a
  drink. Time a 100-run batch of an item-heavy encounter before and after Phase 1.
- **Stamping on commit (Phase 4).** It must be idempotent and cheap, and make no undo step by itself. A test checks all
  three.
- **Ids.** Item pools are `item:<uuid>`. Every label (resource list, report, log) must come from the item's name, never
  the id.
- **Every turn path.** Item use runs inside `takeAutomatedTurn`. Browser-check it through Step, Auto Run, Batch and
  Play anyway.
- **Full healing makes a drink a whole-turn choice (D10).** It's a comparison of two plans (attack and drink with the
  bonus action, or drink with the action), not a search. The joint planner (`selectJointTurnPlan`) mustn't pick the
  potion again on its own: a turn drinks at most what it planned.
- **Order:** Phase 0 → 1 → 2 → 3 → 4 → 5 → 6, on a branch `items` from master.
  - Phases 0 and 1 are headless: potions work in tests and batches.
  - Phase 2 makes them authorable. Phase 3 makes them playable and measured.
  - Phase 4 is the table's two potion rules: the timing, and full healing for an action. Until it lands, potions take
    whatever their editor says (an action from the library), and are always rolled.
  - Phase 5 fills the library. Phase 6 tidies foci.
  - Phases 4, 5 and 6 can ship separately.
