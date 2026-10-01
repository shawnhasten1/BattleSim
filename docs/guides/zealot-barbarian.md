# Guide: Build a Zealot Barbarian (level 5)

This walkthrough builds a level 5 Path of the Zealot Barbarian from scratch: a hard-hitting melee fighter who rages, attacks recklessly, and adds radiant "Divine Fury" damage to a hit each turn while raging.

Along the way you'll use the token creator, the library, the multiattack builder, and the **ability editor** for features — the last one is the important skill, because almost every class feature is built the same way.

> **What you'll end up with:** 55 HP, AC 15, a Greataxe, two attacks per Attack action, Rage (3 uses) with Divine Fury built in, and Reckless Attack.

**Shortcut:** the library has a ready-made **Rage (Zealot)** entry (Add → Library → Features). It bundles Rage and Divine Fury, and its Divine Fury lets the wielder choose radiant *or* necrotic per hit. If you just want the character, attach that and skip to [Step 5](#5-reckless-attack). Read on if you want to understand how it's put together, or need to build a variant.

---

## 1. Create the token

Open the **Actors** tab in the sidebar and click **Create Token**.

![Create Token dialog filled in for the Zealot](img/zealot-barbarian/01-create-token.png)

| Field | Value | Why |
| --- | --- | --- |
| Name | Zealot Barbarian | Anything you like. |
| Faction | Party | Which side they fight on. |
| AC | 15 | Unarmored Defense: 10 + DEX (+2) + CON (+3). |
| HP | 55 | Level 5 with a +3 CON modifier. |
| Speed | 30 | |
| Proficiency | 3 | Level 5. |
| STR / DEX / CON / INT / WIS / CHA | 18 / 14 / 16 / 8 / 12 / 10 | A standard point-buy-style spread favouring STR and CON. |

Click **Create token**. The token appears on the map and in the actor list.

Then select it and click **Sheet** to open its sheet. Weapons, spells, multiattack, and features are all added on the **Abilities** tab.

![The empty Abilities tab](img/zealot-barbarian/02-abilities-empty.png)

> **Tip:** the sheet's **Stats** tab also has **Level** and **Class** fields (they default to 1 / Adventurer). They're informational, so set them to 5 / Barbarian if you like.

## 2. Add the weapon

Click **Add**, stay on the **Library** tab, and choose the **Weapons** filter. Search for `greataxe`.

![Searching the library for Greataxe](img/zealot-barbarian/03-library-greataxe.png)

Click **Greataxe** to attach it. It shows up under **Weapons** as `+7 to hit, reach 5 ft · 10 (1d12 + 4) slashing`, the way a statblock would print it, with a green **FULL** badge meaning the simulator fully supports it. Click its pencil to open it in the ability editor, where each part (how it's used, its reach, the roll, the damage) sits in its own section with a one-line summary.

## 3. Give them Extra Attack

At level 5 a Barbarian attacks twice per Attack action. This is done with the **Multiattack** builder, at the bottom of the Abilities tab.

> **Watch out:** the library also contains an "Extra Attack" entry, but it is **reference-only** — it shows text on the sheet and does nothing in combat. Use the multiattack builder instead.

![The multiattack builder](img/zealot-barbarian/04-multiattack-builder.png)

Click the **Extra Attack (2 swings)** quick-start button. It fills in two swings of your weapon.

![Multiattack filled in](img/zealot-barbarian/05-multiattack-filled.png)

Click **Create multiattack**. It's added under **Features & Traits** with a **FULL** badge.

![Multiattack added to the sheet](img/zealot-barbarian/06-multiattack-added.png)

## 4. Build Rage (with Divine Fury inside it)

Divine Fury only works **while raging**, so it's built as one more effect inside the Rage feature rather than as a separate feature. That way it switches on and off with Rage automatically.

### 4a. Start from the Rage recipe

Click **Add → Preset** and choose **Rage**.

![The Preset tab](img/zealot-barbarian/07-preset-tab.png)

This opens Rage in the ability editor. The preview at the top reads the way the feature works; each section below it has a one-line summary, and opens to its fields.

![Rage in the ability editor](img/zealot-barbarian/08-rage-form-top.png)

What **Use & cost** says:

- **It works: When switched on** — Rage is something the character switches on, not an always-on bonus (Pack Tactics is *Always*).
- **Takes: Bonus action** — switching it on costs the bonus action.
- **Limit: Pool, spends 1 from `rage`** — each use spends one from a pool named `rage`. The pool is added to the creature when you add Rage (see [the check at the end](#check-your-work)).
- **Lasts: 1 minute** — ten six-second rounds.

### 4b. Read what it does while active

Scroll to **While active**. Each card is one thing that's true while Rage lasts, written as a sentence.

![Rage's While active cards](img/zealot-barbarian/09-rage-effects.png)

The recipe gives you: **+2** damage on STR melee hits, **resistance** to bludgeoning, piercing and slashing, and **advantage on STR saves**. Click a card's pencil to see its fields.

### 4c. Add Divine Fury

Click **+ Add effect**. The menu is grouped by what an effect changes (its attacks, its defense, saving throws, staying alive, its turn). Choose **Extra damage on its hits**, then set the card up like this:

![The Divine Fury card](img/zealot-barbarian/10-divine-fury-effect.png)

| Setting | Value | Why |
| --- | --- | --- |
| Damage | `1` d `6` `+2` | The 1d6, plus half the Barbarian level, rounded down (level 5 → 2). Raise it as they level. |
| Type | radiant | Then open the line's **…** and tick **Choose the type each time**, with **radiant** and **necrotic** picked. |
| Once per turn | ticked | Only the first hit each turn. |
| When | nothing picked | It already only happens while Rage lasts. |
| Which attacks | melee and ranged | Any weapon attack. |

> **Radiant or necrotic:** the Zealot picks the type each time. With both picked, the simulator chooses whichever the target resists least.

The card reads *Once per turn, its melee or ranged hits deal an extra 5 (1d6 + 2) radiant or necrotic damage.* Click **Done**, then **Add to sheet**. Rage now appears under Features & Traits as `bonus action: +2 on melee hits, advantage on STR saves, +5 (1d6 + 2) radiant or necrotic on melee or ranged hits once a turn, resists bludgeoning, piercing, and slashing for 1 minute (1 rage)`.

> **Tip:** this is exactly what the library's **Rage (Zealot)** holds. Opening that one in the editor shows the same cards.

## 5. Reckless Attack

Click **Add → Library → Features**, search `reckless`, and click **Reckless Attack**.

Reckless Attack gives advantage on your melee attacks this turn, at the cost of attacks against you having advantage until your next turn. It costs no action, and the AI only switches on features that cost a bonus action (and reactions), so in an automatic fight the Zealot never attacks recklessly. Opening it in the editor says so. Use it by hand when you play the fight yourself.

## Check your work

Your **Abilities** tab should list Greataxe, Rage, Reckless Attack, and Multiattack, all with green **FULL** badges — and the sheet's header badge should also read **FULL**.

![The finished Features & Traits list](img/zealot-barbarian/11-features-list.png)

Then open the **Stats** tab and scroll to **Resources**. You should see a `rage` pool of **3** current / **3** default, created automatically when you added Rage. Three is right for a level 5 Barbarian; change both numbers if you build a different level.

![The rage resource pool on the Stats tab](img/zealot-barbarian/12-stats-resources.png)

Now drop the token onto a map and run a fight from the **Combat** panel. Use **Step** to watch each decision, and see whether the Zealot rages and how Divine Fury shows up in the log.

## Next steps

- Add **Danger Sense** (advantage on DEX saves): **Add → Blank → Feature / trait**, then in **While active** choose **Add effect → Advantage on its saves** and pick **DEX**.
- Tweak the **Tactics** tab to make the Zealot charge in more or less aggressively.
- Build a Bear Totem variant: the library has **Rage (Totem Warrior: Bear)**, which resists every damage type except psychic.
