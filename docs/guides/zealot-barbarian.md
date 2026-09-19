# Guide: Build a Zealot Barbarian (level 5)

This walkthrough builds a level 5 Path of the Zealot Barbarian from scratch: a hard-hitting melee fighter who rages, attacks recklessly, and adds radiant "Divine Fury" damage to a hit each turn while raging.

Along the way you'll use the token creator, the library, the multiattack builder, and the **feature builder** — the last one is the important skill, because almost every class feature is built the same way.

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

Click **Greataxe** to attach it. It shows up under **Weapons** as `melee STR · 1d12 slashing · two-handed`, with a green **FULL** badge meaning the simulator fully supports it.

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

### 4a. Start from the Rage preset

Click **Add → Preset** and choose **Rage**.

![The Preset tab](img/zealot-barbarian/07-preset-tab.png)

This opens the feature builder pre-filled.

![The Rage feature form](img/zealot-barbarian/08-rage-form-top.png)

What the top fields mean:

- **What it does: Something you activate** — Rage is a button the character presses, not an always-on bonus.
- **Activate as: Bonus action** — it costs the bonus action.
- **Lasts (rounds): 10** — one minute is 10 six-second rounds.
- **Spends resource: `rage`** — each use spends one from a resource pool named `rage`. The pool is created for you (see [the check at the end](#check-your-work)).

### 4b. Read the existing effects

Scroll down to **Effects**. Each card is one thing that happens while Rage is active.

![The Rage preset's effects](img/zealot-barbarian/09-rage-effects.png)

The preset gives you: **+2** damage on STR melee attacks, **resistance** to bludgeoning / piercing / slashing, and **advantage on STR saves**.

### 4c. Add Divine Fury

Click **+ Add effect**, then set it up like this:

![The Divine Fury effect](img/zealot-barbarian/10-divine-fury-effect.png)

| Setting | Value | Why |
| --- | --- | --- |
| Effect type | Bonus / penalty damage | Extra damage on top of the weapon hit. |
| Bonus kind | Extra dice + flat | Divine Fury is 1d6 plus a flat bonus. |
| Dice | `1` d `6` | The 1d6. |
| Flat | `2` | Half the Barbarian level, rounded down (level 5 → 2). Raise it as they level. |
| Damage type | radiant | See the note below. |
| Applies to | melee attacks | Divine Fury needs a weapon attack. |
| Applies | once per turn | Only the first hit each turn. |
| When | Always | (Effects already only run during Rage.) |

> **Radiant or necrotic:** in the rules, a Zealot picks radiant *or* necrotic each time. The hand-built version here deals radiant only. The library's **Rage (Zealot)** entry supports the choice, picking whichever type the target resists least. If your enemies are often radiant-resistant, use that entry.

Click **Add to sheet**. Rage now appears under Features & Traits as `bonus · activates Rage`.

> **Tip:** the **Reference text** at the bottom of the form is just a note for you. It still describes plain Rage, so edit it if you want it to mention Divine Fury.

## 5. Reckless Attack

Click **Add → Library → Features**, search `reckless`, and click **Reckless Attack**.

Reckless Attack gives advantage on your melee attacks this turn, at the cost of attacks against you having advantage until your next turn. It costs no action.

## Check your work

Your **Abilities** tab should list Greataxe, Rage, Reckless Attack, and Multiattack, all with green **FULL** badges — and the sheet's header badge should also read **FULL**.

![The finished Features & Traits list](img/zealot-barbarian/11-features-list.png)

Then open the **Stats** tab and scroll to **Resources**. You should see a `rage` pool of **3** current / **3** default, created automatically when you added Rage. Three is right for a level 5 Barbarian; change both numbers if you build a different level.

![The rage resource pool on the Stats tab](img/zealot-barbarian/12-stats-resources.png)

Now drop the token onto a map and run a fight from the **Combat** panel. Use **Step** to watch each decision, and see whether the Zealot rages and how Divine Fury shows up in the log.

## Next steps

- Add **Danger Sense** (advantage on DEX saves) with the feature builder: Blank → Feature / trait → "Advantage on saving throws".
- Tweak the **Tactics** tab to make the Zealot charge in more or less aggressively.
- Build a Bear Totem variant: the library has **Rage (Totem Warrior: Bear)**, which resists every damage type except psychic.
