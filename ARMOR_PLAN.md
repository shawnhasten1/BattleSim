# Armor Plan: armor and shields that set a creature's AC

**Status:** planned and built 2026-10-05 on branch `armor` (from `items`). Decided by the user on 2026-10-05: worn armor
sets the AC (D1), and armor and shields are items (D2). The rest take the defaults below.

Today a creature's AC is one typed number (`CreatureDefinition.armorClass`). Abilities can only add flat bonuses to it:
an item's or a feature's `armor-class-bonus` effect (a Ring of Protection's +1), a condition's `modifiers.armorClass`
(Shield of Faith's +2). There's no armor: no base AC plus a capped Dexterity, no shield, no Strength requirement. So a
fighter in chain mail is "AC 16, typed", and putting on a +1 shield means doing the sum by hand.

## Decisions

| | Decision | Default |
|---|---|---|
| D1 | How worn armor sets AC | **Armor sets it** (user, 2026-10-05): worn armor's base AC, plus Dexterity (all of it for light armor, at most +2 for medium, none for heavy), plus its magic bonus, plus a worn shield's +2 and its magic bonus. The typed AC is the AC *without armor* (natural armor, Unarmored Defense). |
| D2 | Where armor goes | **Items** (user, 2026-10-05): item types `armor` and `shield`, with a Worn switch. Magic armor gets attunement, resistances and uses as any item does; the library and Open5e find armor. |
| D3 | Monsters | Keep their printed AC: the SRD statblocks already include their armor (a goblin's 15 is leather and a shield). Give one armor and its AC follows the armor. |
| D4 | Strength requirement | RAW: heavy armor's wearer below its Strength score has its walking speed cut by 10 ft. |
| D5 | Stealth disadvantage, proficiency | Said on the item, not simulated: there's no stealth, and armor proficiency isn't tracked. |
| D6 | Attunement | Armor that needs attunement still gives its base AC unattuned (the rules' "nonmagical benefits"); its magic bonus and properties need attunement. |
| D7 | Two suits, two shields | Only the best suit and the best shield count; the editor warns. |

## Model (Phase 0)

- `ItemType` gains `"armor"` and `"shield"`. An armor item carries `armor: ArmorStats`:
  `{ category: "light" | "medium" | "heavy" | "shield"; ac; magicBonus?; maxDex?; strength?; stealthDisadvantage? }`.
  `ac` is armor's base (11 for leather, 18 for plate) or a shield's bonus (2). `maxDex` overrides the category's cap
  (Open5e data, a Medium Armor Master). `ItemDefinition.equipped?: boolean` is the Worn switch (absent = worn).
- `armoredAc(definition)` (engine): the AC armor gives, and its parts for the sheet ("chain mail 16 + shield 2").
  Without worn body armor it's the typed AC. `effectiveArmorClass` and the AI's hit chances read it instead of
  `definition.armorClass`; for a creature with no armor it's the same number, so the golden logs can't move.
- The Strength requirement: `movementProfileOf` takes 10 ft off the walking speed.
- Magic armor's specials ride on what items already have (effects, uses, attunement), plus one new effect,
  `no-critical-hits` (adamantine: a critical hit against it becomes a normal hit).

## The sheet (Phase 1)

- The item editor's Basics offers Armor and Shield. An armor item gets an **Armor** section: its weight (light, medium,
  heavy), its AC, its magic bonus (none, +1, +2, +3), the Dexterity it adds (the weight's cap, or its own), the Strength
  it needs, stealth disadvantage, and Worn. Recipes: Armor, Shield.
- The row says it: "AC 16 · heavy · Str 13 · stealth disadvantage", with a worn or carried chip.
- The Stats tab's Armor Class box shows the AC the armor gives when armor or a shield is worn, with its sum, and the
  typed AC moves to "Without armor". The sheet header, the hotbar and the Actors panel show that AC.
- Warnings: two suits or two shields worn; a shield's AC that isn't a bonus (above 5).

## The library and Open5e (Phase 2)

- SRD 5.1 armor: padded, leather, studded leather; hide, chain shirt, scale mail, breastplate, half plate; ring mail,
  chain mail, splint, plate; shield. Magic: Shield +1/+2/+3, Elven Chain, Glamoured Studded Leather, Mithral Half
  Plate, Adamantine Plate, Dwarven Plate, Armor of Invulnerability, Dragon Scale Mail, Demon Armor, Spellguard Shield.
  Any armor can be made +1/+2/+3 in its Armor section.
- An Open5e item with an `armor` block is armor, fully simulated when it's mundane (`ac_base`, `ac_add_dexmod`,
  `ac_cap_dexmod`, `strength_score_required`, `grants_stealth_disadvantage`); a shield is told by name or category
  (the 2024 Shield is filed as heavy armor with base 2). Magic armor from Open5e keeps its base and is marked partial.
- The library audit covers armor.

## AC without armor (Phase 3)

- A feature effect `unarmored-ac` sets the AC without armor from a formula (Unarmored Defense: 10 + Dex + Con, or +
  Wis with no shield; Draconic Resilience: 13 + Dex). The best of the typed AC and these counts.
- Mage Armor (13 + Dex, no armor) becomes that formula on its condition, so it no longer adds +3 on top of armor.
- A feature condition `unarmored` lets an effect apply only without armor (Bracers of Defense: no armor, no shield).

## Risks

- `armorClass` is read in about ten places; every one that means "the AC" goes through `armoredAc`.
- Mage Armor's change moves the AI's numbers for any creature that has it: check the golden logs, and take the change
  only if they hold or the difference is the fix.
