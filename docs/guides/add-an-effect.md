# Guide: Find and add an effect (faster boots, a Tough feat)

An **effect** is one thing a feature, an item or a buff does while it's in force: +1 AC, resistance to fire, 10 ft more speed, more hit points. This guide gives a fighter a pair of boots that make it faster and a Tough feat, using the **Add effect** search, and shows where the results appear on the sheet.

> **What you'll end up with:** boots that add 10 ft of speed, a Tough feat that adds 2 hit points for each level, and a Fast Movement feature that only works out of heavy armor. The sheet shows the speed and hit points they add up to.

---

## 1. Open Add effect

Effects live in an ability's **While active** section (an item's is called **While carried**). Make the ability first: on the sheet's **Abilities** tab, click **Add ability**, search for **Worn item**, and pick the recipe. Name it, then click **+ Add effect** in **While carried**.

![The Add effect picker on a worn item](img/add-an-effect/01-picker.png)

- **The search box** has focus as soon as it opens. Type what you're thinking of: "speed", "boots", "resistance", "hp", "tough".
- **Common on an item** is a short row of the effects items usually have. A buff and a trait each have their own row.
- **The folds** hold every effect, grouped by what it changes: Movement, Hit points, Scores, size & initiative, AC & defenses, and so on. Open one to see what's in it.

![The Movement fold open](img/add-an-effect/02-movement.png)

Rarer class and monster mechanics (Metamagic, Monk weapons, swarm damage) are in the last fold, out of the way.

## 2. Boots that make it faster

Type **speed**. The Speed effect comes first, with examples underneath to **start from**: each one adds the effect already filled in.

![Searching for speed](img/add-an-effect/03-search-speed.png)

Click **Speed** (or an example). The card opens:

![The Speed card](img/add-an-effect/04-speed-card.png)

- **Its walking speed changes by:** type 10 for +10 ft (a negative number slows it).
- **Its speed is** doubled or halved (Boots of Speed, Slow).
- **At least** sets a minimum (Boots of Striding and Springing: 30 ft).
- **A new flying, swimming, climbing or burrowing speed**, as a number of feet or equal to its walking speed (Winged Boots).

The line at the bottom says what the effect does, in words. Click **Done**, then **Add to sheet**.

## 3. A Tough feat

Tough isn't part of the free rules, so it isn't in the library. You can build it in a few seconds:

- **The quick way:** in **Add ability**, search for **tough**. The **More hit points per level** recipe makes a feature called Tough with the effect already set.

![Searching Add ability for tough](img/add-an-effect/05-add-tough.png)

- **By hand:** make a **Trait or feature**, then in **While active** click **+ Add effect** and search **tough**. Pick **+2 for each level, like the Tough feat**.

![Tough's hit point effect](img/add-an-effect/06-tough-effect.png)

The **Hit point maximum** card counts **in all** (Aid: +5), **for each of its levels**, or **for each level of one class** (Draconic Resilience: a sorcerer's levels). If the creature has no level yet, the card says so: set one under **Stats › Level & CR**.

## 4. See what it adds up to

The **Stats** tab keeps the numbers you typed, and under each one shows what the creature's effects make it:

![Speed and Max HP with their effects](img/add-an-effect/07-stats.png)

- **Max HP 32** is the base. *With its effects: 34: 32 base, Tough +2* is what it fights with.
- **Speed 30** is the base. *With its effects: 40 ft: 30 base, Boots of the Swift +10* is how far it moves.

The sheet's header, the Codex and the token's hit points use the actual numbers. A token at full hit points stays at full when you add Tough or attune an item. The simulator moves, paths and plans with the actual speed.

## 5. Only while… (Fast Movement)

Some effects only work some of the time. Make a **Trait or feature** called Fast Movement, open **Add effect** and search **fast movement**. The example comes first; press **Enter** to add it.

![An example found by name](img/add-an-effect/08-search-example.png)

![Fast Movement's Speed card, with While](img/add-an-effect/09-while.png)

**While** limits the effect to:

- **the armor it wears:** armor, no armor, or no heavy armor (Fast Movement);
- **a shield,** or no shield (Unarmored Movement: no armor and no shield);
- **one of its own activations being on** (an effect that only works while it rages).

It's on the card for Speed and AC bonus, and under **More options** for most other effects.

## 6. When there's no effect for it

If nothing matches what you typed, the picker says so:

![Nothing matches darkvision](img/add-an-effect/10-nothing.png)

The simulator doesn't run everything (vision and skill checks outside a fight, for example). Write the rule in the ability's **Notes & AI**. If the ability can't work without it, set **The simulator** to **Reference only** there, and resolve it by hand when it comes up.

## 7. Keep it for next time: My library

The boots you made live on this fighter only. To use them on other creatures and in other encounters, click **Save to my library** at the top of the editor while it's open (before or after **Add to sheet**). Give it a name and click **Save to my library**.

From then on, **Add ability** lists it under **My library** (there's a filter for it too) for any creature: click the row to check it first, or **+** to add it as it is. A copy you open again from a sheet can update its entry in your library, or be saved as a new one beside it. **×** on the row removes it from your library; creatures that already have a copy keep it.

---

**Recipes to try** in Add ability: *Faster without heavy armor*, *Faster without armor or a shield*, *Proficiency in a save* (a feat like Resilient) and *A bonus while wearing armor* (the Defense fighting style).
