"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, LayoutGrid, Swords } from "lucide-react";
import type { GuideSummary } from "@/lib/guides";
import { SrdAttribution } from "./SrdAttribution";
import { TokenIconCredits } from "./TokenIconCredits";
import styles from "./docs.module.css";

interface Section {
  id: string;
  label: string;
  content: ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    content: (
      <>
        <p>
          BattleSim is a tabletop-RPG battle simulator: you build a map, populate it with actors (player
          characters and monsters), and then run combat turn-by-turn — either watching it play out live or
          fast-forwarding hundreds of runs to see how a fight tends to go.
        </p>
        <p>The basic flow is:</p>
        <ol>
          <li>
            <strong>Sign up / log in</strong> — every campaign you create is scoped to your account.
          </li>
          <li>
            <strong>Create a campaign</strong> — a folder that holds a set of encounters (see{" "}
            <a href="#campaigns">Campaigns</a>).
          </li>
          <li>
            <strong>Create an encounter</strong> inside that campaign and open it in the editor (see{" "}
            <a href="#encounters">Encounters</a>).
          </li>
          <li>
            <strong>Build the map</strong> — draw walls, paint terrain, drop in a background image (see{" "}
            <a href="#walls">Walls, Terrain &amp; Height</a>).
          </li>
          <li>
            <strong>Add actors</strong> to each side and fill out their sheets — stats, attacks, spells,
            AI behavior (see <a href="#actors">Actor Sheets</a> and <a href="#spells">Spells &amp; Attacks</a>
            ).
          </li>
          <li>
            <strong>Run it</strong> — roll initiative and step through, auto-play, or batch-simulate the fight
            from the Combat panel; or play it yourself (see <a href="#play">Playing a Fight by Hand</a>).
          </li>
        </ol>
        <p>
          You don't have to start from a campaign — the sandbox at <code>/</code> is a scratch encounter that
          isn't saved to any campaign, good for quickly testing a matchup.
        </p>
      </>
    )
  },
  {
    id: "campaigns",
    label: "Campaigns",
    content: (
      <>
        <p>
          A campaign is the top-level container for your encounters — think of it as a folder for one
          ongoing game or one set of fights you're testing. From the <strong>Campaigns</strong> page you can:
        </p>
        <ul>
          <li>
            <strong>Create</strong> a campaign by typing a name and hitting <em>New Campaign</em>.
          </li>
          <li>
            <strong>Set a cover image</strong> on a campaign card (the image icon) so it's easier to pick out
            in the list.
          </li>
          <li>
            <strong>Rename</strong> or <strong>delete</strong> a campaign from the icons on its card. Deleting
            a campaign deletes every encounter inside it — there's no undo, so the app asks you to confirm
            first.
          </li>
          <li>Click a card to open that campaign and see its list of encounters.</li>
        </ul>
        <p>
          Above a campaign&apos;s encounters are its <strong>Campaign rules</strong>, the table&apos;s rulings every
          encounter in it plays by, saved as they&apos;re set: whether counterspellers know what&apos;s being cast and
          at whom (see <a href="#features">Features &amp; Traits</a>), what drinking or giving a potion takes, and whether a healing
          potion used with an action instead of a bonus action heals in full (see <a href="#items">Items</a>). An
          encounter takes them as it opens, and an open one at once, so a run, a saved run or an exported encounter
          carries the rules it ran under. A rule that does nothing under the others is greyed out, and says why.
        </p>
        <p>Everything you create is private to your account — other users can't see or edit your campaigns.</p>
      </>
    )
  },
  {
    id: "encounters",
    label: "Encounters",
    content: (
      <>
        <p>
          Inside a campaign, click <strong>New Encounter</strong> to open the Create Encounter dialog:
        </p>
        <ul>
          <li><strong>Encounter name</strong>.</li>
          <li>
            <strong>Grid size</strong> — pick a preset (Landscape 40×30, Portrait 30×40, Square 40×40) or hit{" "}
            <strong>Custom…</strong> for exact columns, rows, pixels-per-square, and feet-per-square.
          </li>
          <li>
            <strong>Background (optional)</strong> — upload an image now, or leave it blank and start with an
            empty grid; you can always add or replace it later from Scene settings. When you upload one, the
            canvas automatically resizes to match its shape rather than cropping it to a fixed size.
          </li>
        </ul>
        <p>
          The scene-switcher dropdown in the top bar has the same dialog under <strong>New scene</strong>,
          with an extra choice: <strong>Clone current map</strong> (copies your walls/terrain/tokens into a
          new scene, named "&lt;name&gt; Variant") or <strong>Start fresh</strong> to open the same
          name/grid/background picker instead. Replacing an existing background image on a map that already
          has walls, terrain, or tokens placed will warn you first if the new image's proportions don't match
          the old one, since that can throw off everything already positioned.
        </p>
        <p>
          Opening an encounter drops you into the main editor, which is made up of a few areas:
        </p>
        <ul>
          <li>
            <strong>Top bar</strong> — switch scenes, open the Encounter Builder, undo/redo, save, reset the
            encounter, view the battle report, and scene settings (grid size, background image, and{" "}
            <strong>Padding (sq)</strong> — extra border around the map outside the grid, Foundry-VTT style).
          </li>
          <li>
            <strong>Left tool rail</strong> — the map-editing tools: draw walls, paint terrain, measure, place
            templates, move tokens.
          </li>
          <li>
            <strong>Sidebar</strong> — your roster and the Combat panel.
          </li>
        </ul>
        <p>Once your map and roster are ready, the Combat panel drives the fight:</p>
        <ul>
          <li>
            <strong>Initiative</strong> rolls turn order for every actor on the board.
          </li>
          <li>
            <strong>Step</strong> advances a single action at a time — good for watching exactly what the AI
            decides to do and why.
          </li>
          <li>
            <strong>Auto Run</strong> plays the entire fight live, action by action, without you clicking
            Step repeatedly.
          </li>
          <li>
            <strong>Batch 100</strong> fast-forwards the encounter 100 times with no animation and reports
            aggregate results (win rate, average rounds) — useful for balancing a fight rather than watching
            one outcome of it.
          </li>
        </ul>
        <p>
          Each side can be given a tactics profile (e.g. skirmisher, brute, defender, controller) that steers
          how its actors choose targets and abilities, and a side can start <strong>surprised</strong>, which
          costs it its first turn.
        </p>
      </>
    )
  },
  {
    id: "walls",
    label: "Walls, Terrain & Height",
    content: (
      <>
        <p>
          The battle map is a grid you can drop a background image onto and then build out with walls and
          terrain using the left tool rail.
        </p>

        <h3>Walls & cover</h3>
        <p>
          <strong>Walls</strong> are line segments you draw between grid points. Each wall can:
        </p>
        <ul>
          <li>Block projectiles and line of sight, or not.</li>
          <li>
            Have a <strong>door state</strong> (open, closed, or destroyed) — an open or destroyed door stops
            blocking anything.
          </li>
          <li>
            Carry a <strong>cover level</strong>: half, three-quarters, or total. Cover reduces (or, at
            total, entirely blocks) an attacker's ability to target a creature standing behind it. On the map,
            heavier cover is drawn as a thicker, more solid line; lighter cover fades to a thin dashed line.
          </li>
        </ul>
        <p>
          Cover is worked out automatically during combat: the engine samples several lines from the attacker
          to the corners and center of the target's square, and uses the strongest obstruction it finds (a
          wall or another creature standing in the way) to decide how much cover applies to that shot.
        </p>

        <h3>Painting terrain</h3>
        <p>
          Select the <strong>Terrain</strong> tool in the left rail to reveal a brush sub-toolbar. Click a
          cell to paint it, or click-and-drag to paint every cell the cursor crosses — the whole stroke undoes
          in one step. Shift-click to multi-select painted tiles. The brush presets:
        </p>
        <ul>
          <li><strong>Difficult terrain</strong> — half speed (×2 move cost).</li>
          <li><strong>Greater difficult terrain</strong> — quarter speed (×4 move cost).</li>
          <li><strong>Impassable</strong> — blocks movement entirely.</li>
          <li><strong>Acid</strong> — DC 12 Dex save, 2d6 acid damage (half on a success), re-checked every round spent standing in it.</li>
          <li><strong>Lava</strong> — 4d10 fire damage on entry or while standing in it, no save.</li>
          <li><strong>Ice</strong> — DC 10 Dex save or fall prone on entry; no damage at all.</li>
          <li><strong>Eraser</strong> — clears painted terrain instead of adding it.</li>
        </ul>
        <p>
          Each hazard tile shows a small icon (a droplet, flame, or snowflake) so its type reads at a glance
          regardless of color. The AI treats hazardous and difficult/impassable terrain as real danger and
          cost when pathing — the same avoidance logic that steers it around a Spike Growth zone (see{" "}
          <a href="#zones">Zones &amp; Persistent Effects</a>) applies here too.
        </p>

        <h3>Editing painted terrain</h3>
        <p>
          Right-click one or more selected tiles for a context menu: swap the terrain type for the whole
          selection, step the movement-cost multiplier up/down, and — if every selected tile shares the same
          hazard — fine-tune that hazard's own <strong>Save DC</strong> and <strong>damage dice</strong> count
          beyond the three fixed presets (e.g. turn a DC 12 acid pool into a DC 15 one, or bump 2d6 up to
          3d6). The same menu deletes the selection.
        </p>

        <h3>Ground height, ramps &amp; cliffs</h3>
        <p>
          Select the <strong>Elevation</strong> tool (the stacked-layers icon) to open the Ground height
          palette. Height is its own layer, separate from terrain, so a lava pool can sit on top of a hill.
          Hover a cell to see its height (and what the brush would change it to). The modes:
        </p>
        <ul>
          <li><strong>Paint</strong> — drag over cells to set them to the chosen height (type a value or pick a preset).</li>
          <li><strong>Raise 5 / Lower 5</strong> — each cell you drag over goes up or down one 5 ft step.</li>
          <li>
            <strong>Ramp</strong> — paint the two levels first, then drag from the low end to the high end;
            the steps in between fill in. The preview turns red and tells you how long the ramp needs to be if
            it is too steep to walk.
          </li>
          <li><strong>Flatten</strong> — drag to level cells back to ground height; <em>Flatten map</em> clears every height.</li>
        </ul>
        <p>
          A walker can step up or down <strong>5 ft</strong> between neighbouring squares, which is what a
          stair or a ramp gives it. Anything steeper is a <strong>cliff</strong>, drawn on the map as a heavy
          dark-red line: walkers can&apos;t cross it (they path around to a ramp), climbers can at a square of
          movement per 5 ft, and fliers ignore it. A creature shoved off a ledge falls the difference; one
          shoved into a cliff face stops against it. Height also counts toward reach and range, so a spearman
          on the ground can&apos;t hit someone standing on a 10 ft ledge overhead.
        </p>

        <h3>Flying &amp; altitude</h3>
        <p>
          A creature with a fly speed can be airborne. Set a token&apos;s starting altitude from its
          right-click menu (<strong>Flight</strong> → Altitude, or <strong>Land</strong>; works on a whole
          selection) or the sheet&apos;s Token tab, under This fight. An airborne token floats over a shadow
          with its height on a badge.
        </p>
        <ul>
          <li>
            Reach and range are measured in three dimensions: a creature more than its reach overhead can&apos;t be
            hit in melee, but bows, spells and breath weapons still reach it. The log says so plainly when a
            fighter can&apos;t reach a flier.
          </li>
          <li>Climbing or diving costs movement like any other flying (5 ft of fly speed per 5 ft of height).</li>
          <li>Rising out of a foe&apos;s reach provokes an opportunity attack, just like walking out of it.</li>
          <li>
            A flier that is knocked prone, restrained, grappled, stunned, paralyzed, unconscious or killed
            <strong> falls</strong>: 1d6 bludgeoning per 10 ft (up to 20d6), landing prone. Creatures that
            <strong> hover</strong> (a toggle beside fly speed on the Stats tab) stay up.
          </li>
          <li>
            In automated fights, melee fliers swoop down just far enough to strike, and ranged fliers climb
            out of reach of foes who can&apos;t follow them up.
          </li>
        </ul>
        <p>
          Walls still block sight and movement at every height, and cover doesn&apos;t yet account for height.
        </p>
      </>
    )
  },
  {
    id: "actors",
    label: "Actor Sheets",
    content: (
      <>
        <p>
          Every token on the board — player character or monster — has an actor sheet behind it. Its top shows the
          token&apos;s vitals on every tab: HP and temp HP to edit, AC, speed and faction, and its conditions. Hover a
          condition to see what it does, where it came from and what ends it; its <strong>×</strong> takes it off, and{" "}
          <strong>+ Condition</strong> adds any of the standard ones. A downed token shows its death saves, and a
          concentrating one what it&apos;s concentrating on. The title bar counts how many of its abilities the simulator
          runs, and its <strong>⋯</strong> menu saves the creature to your library, exports the token as JSON, duplicates
          it, makes it its own creature, or deletes it.
        </p>
        <p>
          A player character can be built from the 2024 rules instead of by hand: <strong>Create Token → Character</strong>{" "}
          makes one (or a whole party) at any level, and its sheet levels it up, into a second class too. Your own classes,
          subclasses, feats, backgrounds and species go in the <strong>Homebrew</strong> window beside the SRD&apos;s. The{" "}
          <a href="/docs/guides/build-a-character">character builder guide</a> walks through all of it.
        </p>
        <p>
          The tabs are grouped by what they change. <strong>Stats</strong> and <strong>Abilities</strong> change the
          creature, which every token of it in the scene shares (the caption above them says how many);{" "}
          <strong>Token</strong> changes this token only. To give one token different stats (a goblin boss among
          goblins), choose <strong>⋯ → Make it its own creature</strong>: it gets a copy of its creature, named after it,
          and Stats opens with the name ready to rename. A shapechanger can&apos;t be split from its forms, nor a creature
          that a summon makes by name, and the menu says why.
        </p>
        <ul>
          <li>
            <strong>Stats</strong> — the creature as a statblock reads: size, type, alignment, Armor Class, max HP and
            speeds (fly, swim, climb and burrow as chips, with hover on fly), then its ability scores with each save
            beneath (◆ marks a proficient one; click it to switch, or type a save&apos;s whole bonus). Below fold its{" "}
            <strong>Skills</strong> (Athletics and Acrobatics are what it escapes grapples with),{" "}
            <strong>Defenses</strong>, <strong>Senses &amp; languages</strong>, and <strong>Level &amp; CR</strong> (its
            classes, its level, which scales its cantrips, and its proficiency bonus). Each folded section reads like
            its statblock line. A proficient save or skill keeps up when its score or the proficiency bonus changes; a
            number of its own stays as typed.
          </li>
          <li>
            <strong>Abilities</strong> — the attacks, spells, and features this actor can use in combat, and every
            resource they spend.
          </li>
          <li>
            <strong>Token</strong> — this token: its name and side, then <strong>This fight</strong> (whether it starts
            on the board or arrives on a later round, whether it&apos;s surprised, which spells it cast beforehand, like
            Mage Armor, are already up, its altitude if it flies, and whether it&apos;s in its lair; the first three are
            set before the fight starts), <strong>Tactics</strong> (its profile, which decides how the AI plays it, and
            how freely it spends slots and limited uses, each with what it does; what a new token of its creature starts
            with, and <strong>Use these for every Knight</strong> to make this token&apos;s the default and give them to
            every Knight in the scene; whether enemies target it normally, first or last, and whether its allies protect
            it; and what the AI will use, by the Abilities tab&apos;s dots, each name opening that ability),{" "}
            <strong>Appearance</strong> (its image, for this token
            or for every token of its creature, its border, a nameplate, and with an image its scale and glow) and{" "}
            <strong>Status &amp; position</strong> (a state you set by hand, such as Fled, and its square). The
            right-click menu and the Combat panel change the same settings.
          </li>
        </ul>
        <p>
          A box changes the sheet as you type, and each box you edit is one undo step. A new max HP brings tokens
          at full HP along with it; wounded ones keep their HP.
        </p>
        <p>
          The Abilities tab lists what the actor has in statblock order: <strong>Traits</strong>, <strong>Actions</strong>,{" "}
          <strong>Bonus actions</strong>, <strong>Reactions</strong>, <strong>Spellcasting</strong>, <strong>Legendary
          actions</strong>, <strong>Lair actions</strong> and <strong>On death</strong>. Each ability appears once, where it&apos;s
          mainly used: Rage with the bonus actions, Extra Attack with the actions, a feature that&apos;s always on with the traits.
          Within a group, a multiattack (or Extra Attack) comes first, then the weapons, the creature&apos;s own actions, and what
          its features give.
        </p>
        <ul>
          <li>
            <strong>A row</strong> reads like a line from a statblock (<em>+6 to hit, reach 5 ft · 11 (2d6 + 4) slashing</em>),
            worked out from the numbers the simulator actually rolls. A chip says what it costs (Recharge 5–6, 3/encounter,
            1 rage) and another its other uses (power attack, also a bonus action). Its dot says how much of it the simulator
            runs: ● all of it, ◐ part of it, ○ reference only; hover it to see why. A half dot also marks what the AI never uses
            on its own (Reckless Attack, a reaction set to manual) and what does nothing yet, the way the editor&apos;s warnings do.
          </li>
          <li>
            <strong>Click a row</strong> to edit it. Its <strong>⋯</strong> menu duplicates it beside itself, moves an action
            between Actions, Bonus actions and Reactions, or deletes it; a note after a delete offers <strong>Undo</strong>.
          </li>
          <li>
            <strong>Spellcasting</strong> gives the actor&apos;s spellcasting ability (pick another there: Auto uses the one its
            spells name most), save DC, attack bonus and caster level, then its spells by level with the slots it has left.
          </li>
          <li>
            <strong>Resources</strong>, above the list, is everything it spends, in one list: spell slots by level, uses, a
            breath that&apos;s ready or recharging, pools (rage, ki, legendary resistance), a weapon&apos;s charges, and legendary
            actions a round. Folded, it&apos;s one line. Open it to see what this token has left (dots to click, or a number)
            beside what every token of the creature starts a fight with. Changing a full size changes the ability that
            spends it too, so its editor and its statblock line agree, and tokens that were full stay full.{" "}
            <strong>Add a spell slot level</strong> adds one; a level its spells need but it hasn&apos;t is listed, waiting
            for a number. <strong>Add a pool</strong> names a new one (Ki points, Superiority dice) and its size; an
            ability spends it once you pick it in the ability&apos;s Use &amp; cost (Limit, then Pool). Uses, recharges and
            charges come with the ability that has them. <strong>Refill all</strong> tops this token up, and a pool
            nothing spends yet is listed apart, to remove.
          </li>
        </ul>
        <p>
          Every ability opens in the <strong>ability editor</strong>, in place of the list: weapons and focuses, attacks,
          multiattacks, spells, special actions (saves, areas, heals, buffs, teleports), summons, shapechanges, features
          and traits, legendary actions, lair actions and death effects. Its preview at the
          top shows the ability as a statblock entry, with whether the simulator runs all of it, and any warnings
          (a pool the creature doesn&apos;t have, a trigger that never fires) with a link to the section that fixes
          them. Below, each section (Use &amp; cost, Target, Roll, Damage, Effects, Notes &amp; AI and more; see{" "}
          <a href="#spells">Spells &amp; Attacks</a>) shows a one-line summary and opens to its settings, with the rarer
          ones under <strong>More options</strong>. Save is one undo step and does nothing until something changes;
          Esc or leaving the sheet asks before throwing changes away. See <a href="#features">Features &amp; Traits</a> for
          features, and <a href="#traits">Monster Traits, Legendary &amp; Lair Actions</a> for legendary actions, lair actions
          and death effects.
        </p>
        <p>
          For power users, <strong>Notes &amp; AI</strong> has <strong>Edit as JSON</strong>: the ability as JSON. Edit it and{" "}
          <strong>Check</strong>: it must parse (an error says the line and column), its parts must fit the simulator&apos;s
          schemas, and it&apos;s tidied the way a save would. You see what changes, line by line; <strong>Apply</strong> puts it
          in the editor, and Save commits it as usual. Ids are kept, since other abilities point at them. It&apos;s also where
          the rare part with no control of its own is changed, such as a bonus that adds a number, an ability modifier and
          proficiency: the editor reads it out and says so.
        </p>
        <p>
          You can build an actor by hand on the Abilities tab, or start from an SRD monster (copy it to your library from
          its menu in the Actors tab) or an Open5e creature (Create Token) and adjust it from there. Double-click an actor in
          the Actors tab to open its sheet, with or without a token on the map; a library actor is linked, so a change to it
          anywhere is saved to your library. Actors also carry a{" "}
          <strong>creature type</strong> (beast, undead, fiend, etc.), which some spells and features key off
          of — see <a href="#spells">restrictions by creature type</a> below.
        </p>
      </>
    )
  },
  {
    id: "spells",
    label: "Spells & Attacks",
    content: (
      <>
        <p>
          Spells, attacks and special actions (a breath, a gaze, a heal) are all built in the{" "}
          <strong>ability editor</strong>, which opens in place of the Abilities list. This section walks through
          it: how to start one, what each section does, and two worked examples.
        </p>

        <h3>Adding one</h3>
        <p>
          <strong>Add ability</strong> on the Abilities tab opens one search over everything you can add, with filters for
          your own library, weapons, spells, items, monster abilities, traits and features, and recipes. Enter takes the
          first thing found; Esc clears the search, then closes it.
        </p>
        <ul>
          <li>
            <strong>My library</strong> — abilities you&apos;ve saved, for any creature in any encounter: items, weapons,
            spells, features, actions, bonus actions, reactions, lair and legendary actions, and what happens on death. In
            the ability editor, <strong>Save to my library</strong> keeps a copy under the name you give it (an SRD item
            changed to suit your table, a Tough feat you built, a breath weapon): the sheet itself only changes with the
            editor&apos;s own button. A summon or shapechange keeps the creatures it names with it; a multiattack uses the
            abilities of the same names on the creature it&apos;s added to (if it lacks one, the editor opens to choose). A
            copy that came from your library can update that entry or be saved as a new one. Its row works like a library
            row (click to check it, <strong>+</strong> to add it), and <strong>×</strong> removes it from your library;
            copies already on creatures stay as they are. It&apos;s kept with your account.
          </li>
          <li>
            <strong>Recipes</strong> — patterns to start from: a damage cantrip, a save-or-condition spell, an area blast,
            healing, a buff, a teleport and a reaction spell; a breath weapon, frightful presence, a poison bite, a grappling
            claw, a swallow and a parry; Rage, Pack Tactics and the other features. One opens in the editor with the sections
            to fill in marked <em>fill in</em>.
          </li>
          <li>
            <strong>Library</strong> — the built-in SRD weapons, spells and features. Click one to check it in the editor
            first (it&apos;s added when you save), click its <strong>+</strong> to add it as it is, or drag it onto the sheet.
            After a <strong>+</strong> the panel stays open for the next one (<strong>Done</strong> closes it), and rows the
            creature already has say <em>on the sheet</em>.
            A spell casts with this creature&apos;s spellcasting ability (below): its DC and attack bonus follow it, and a heal
            adds its modifier.
          </li>
          <li>
            <strong>From SRD monsters</strong> — any library monster&apos;s ability, copied into the editor: a dragon&apos;s
            Fire Breath, a knight&apos;s Parry, Pack Tactics. It brings the pools it spends.
          </li>
          <li>
            <strong>Start from scratch</strong> — <em>Spell</em> starts a 1st-level spell attack, <em>Special action</em> a
            monster&apos;s saving throw, and <em>Attack</em> a claw or a bite; there are also <em>Weapon</em>,{" "}
            <em>Multiattack</em>, <em>Trait or feature</em>, <em>Reaction</em>, <em>Legendary action</em>, <em>Lair action</em>, <em>On death</em>,{" "}
            <em>Summon</em> and <em>Shapechange</em>. The Roll and Target sections turn a spell or an action into anything else.
          </li>
          <li>
            <strong>Search Open5e</strong> — an Open5e spell comes in as reference text the simulator doesn&apos;t cast. Open it
            and pick how it works in its Roll section to simulate it.
          </li>
        </ul>

        <h3>The spellcasting ability</h3>
        <p>
          A creature&apos;s spellcasting ability is set on its <strong>Stats</strong> tab. A spell&apos;s DC or attack
          bonus can follow it: change it from WIS to CHA and every spell that follows it moves with it. A spell can
          use an ability of its own instead (the DC&apos;s ability in its Roll section, or the attack&apos;s Uses). A
          creature without one gets one the first time a spell follows it: the ability its spells name most, or else
          its highest of INT, WIS and CHA.
        </p>

        <h3>The sections</h3>
        <p>
          Each section shows a one-line summary and opens to its settings; rarer ones sit under{" "}
          <strong>More options</strong>, which says how many are set. The preview at the top is the ability as a
          statblock entry.
        </p>
        <ul>
          <li>
            <strong>Basics</strong> (spells) — level (cantrip or 1st–9th), school, concentration and ritual;
            components and source under More options. Changing the level moves the slot with it, and a cantrip is
            cast at will.
          </li>
          <li>
            <strong>Use &amp; cost</strong> — what it takes (an action, a bonus action or a reaction) and what it
            spends: at will, a spell slot (of its level to begin with), uses per encounter, a recharge, or a pool you
            pick or create. A reaction shows its trigger: hit by an attack, targeted by an attack, a creature leaving
            its reach, or something described. Any leveled spell can be cast with a higher slot, once its own are gone
            or by choice in Play; <strong>Casting with a higher slot</strong> says so, and offers the SRD&apos;s
            upcasting for a spell of the same name that has none (never taken by itself). With a slot,{" "}
            <strong>Stronger with a higher slot</strong> adds dice,
            beams or targets for each level above.
          </li>
          <li>
            <strong>Target</strong> — one creature (5 ft reads as touch), several, itself, or an area: a sphere,
            cone, line or cube, its size, and where it starts (around itself, at a point in range, or out from itself
            the way a cone goes). A small diagram draws it to scale. An area save also picks whether it affects
            everyone in it or only its enemies; a teleport picks who teleports and how far.
          </li>
          <li>
            <strong>Roll</strong> — <em>How it works</em>: an attack roll, a saving throw, or automatic (it heals,
            grants a benefit, teleports, summons, changes shape, or takes a standard action such as Dash or Disengage).
            Switching keeps what the two kinds share and sets the rest aside, so
            switching back brings it back; a note says what moved. A saving throw sets the ability, the DC (as
            printed, or calculated from 8 + an ability + proficiency) and what a success does: half damage, no
            damage, or avoids it entirely.
          </li>
          <li>
            <strong>Healing</strong> or <strong>Benefit</strong> — for an automatic ability: healing lines (dice
            plus the ability they add), or what a buff grants (AC, attack rolls, saving throws, attacks against it,
            temporary hit points; resistances and a condition such as invisible under More options) and how long
            it lasts. Anything else it grants (advantage on attacks, extra damage on hits) is a card under{" "}
            <strong>Other effects</strong>, as in <a href="#features">While active</a>, and so is anything else it
            changes (its speed, actions it can&apos;t take, an immunity or a vulnerability). <strong>Cast before
            combat</strong> (under Use &amp; cost) keeps a long buff like Mage Armor out of the fight.
          </li>
          <li>
            <strong>Summon</strong> — the creatures it calls up (any SRD monster or an actor in the scene, searched by
            name), how many (a number, or dice such as 1d4), which one when there are several (its choice or at random),
            the chance it works (a mephit&apos;s 25%), how long they stay and how far away they appear. Library creatures
            are fetched as you pick them and added to the scene when you save; a summon that would loop back on itself
            (A summons B, B summons A) isn&apos;t saved.
          </li>
          <li>
            <strong>Shapechange</strong> — the forms it can take (each a creature: its AC, speed, actions and traits;
            hit points and conditions stay), whether it can change back, and whether it does when it dies. Each form gets
            the same shapechange, so a creature that has changed can change again.
          </li>
          <li>
            <strong>Standard action</strong> — Dash, Disengage, Dodge, Hide, Help or escaping a grapple, taken as an
            action or a bonus action (Nimble Escape, Aggressive). The simulator doesn&apos;t hide, and Help is only
            partly simulated.
          </li>
          <li>
            <strong>Damage</strong> — lines of dice, the ability each adds, and a type, with averages. A
            cantrip&apos;s lines can grow at levels 5, 11 and 17 (a line&apos;s own More).
          </li>
          <li>
            <strong>Effects</strong> — cards grouped by when they happen: on a hit, a critical hit or a miss after an
            attack; on a failed save, a successful one or either way after a save. After a save, a condition
            doesn&apos;t roll a save of its own (the save already decided it), and if it lasts until the creature
            shakes it off, it repeats that save. A card can be limited to{" "}
            <strong>creature types</strong> (Turn Undead) under its More options.
          </li>
          <li id="zone-builder">
            <strong>Lingering area</strong> (area saves) — makes the area stay on the map, the way Web, Cloudkill,
            Spike Growth and Moonbeam do: how long it lasts, when it affects a creature (entering it, starting or
            ending a turn in it), whether it also hits everyone in it when it appears, how it moves (stays put, moves
            with its caster, drifts away each turn, or the caster moves it with a bonus action), difficult or
            impassable ground, damage for moving through it, and whether it&apos;s heavily obscured. See{" "}
            <a href="#zones">Zones &amp; Persistent Effects</a> for how they play.
          </li>
          <li>
            <strong>While active</strong> (Shield) — how long it lasts and what it gives meanwhile; see{" "}
            <a href="#features">Features &amp; Traits</a>.
          </li>
          <li>
            <strong>Notes &amp; AI</strong> — reference text, and whether the simulator uses it at all. Edit as JSON is
            here too.
          </li>
        </ul>
        <p>
          A weapon is something the creature attacks with. A <strong>focus or wand</strong> (a staff, a holy symbol), which
          makes no attack of its own, is an item (see <a href="#items">Items</a>): its charges, what it does while carried
          and what it lets the creature use, each use opened in the editor with a breadcrumb (<em>Staff of Fire ›
          Fireball</em>). One saved as a weapon before opens under Items, its charges and every token&apos;s count kept. A
          staff that is also a weapon (a quarterstaff that casts) stays a weapon, with what it grants.
        </p>
        <p>
          Warnings under the preview point at the section that fixes them: a spell whose slot the creature
          doesn&apos;t have (&quot;Never usable&quot;), a lingering area that never affects anyone, a benefit that grants
          nothing, or success effects a save that &quot;avoids it&quot; never reaches.
        </p>

        <h3>Worked example: building Fireball from scratch</h3>
        <ol>
          <li>Abilities tab → Add ability → Start from scratch → Spell. Name: <em>Fireball</em>.</li>
          <li>Roll: How it works → <em>Saving throw</em>. Target: Reaches → <em>An area</em> (a 20-ft sphere at a point); within <em>150</em> ft.</li>
          <li>Roll: A success → <em>Half damage</em>. Damage: <em>8</em> d <em>6</em> fire.</li>
          <li>Basics: Level → <em>3rd</em>; it now spends a 3rd-level slot. Use &amp; cost: tick <strong>Stronger with a higher slot</strong> (+1d6 per level above).</li>
          <li>Add to sheet. Give the caster 3rd-level slots (and higher, to upcast) in Resources, above its abilities: a level its spells need is listed there, waiting for a number. The editor warns until it has them.</li>
        </ol>

        <h3>Worked example: a Cloudkill-style poison cloud</h3>
        <ol>
          <li>Abilities tab → Add ability → Start from scratch → Spell. Name: <em>Poison Cloud</em>. Basics: Level → <em>5th</em>, tick <strong>Needs concentration</strong>.</li>
          <li>Roll: How it works → <em>Saving throw</em>. Target: Reaches → <em>An area</em>.</li>
          <li>Roll: Saving throw → <em>CON</em>, A success → <em>Half damage</em>. Damage: <em>5</em> d <em>8</em> poison.</li>
          <li>Lingering area: tick <strong>Leaves a lingering area</strong>. It lasts while its caster concentrates and affects a creature that enters it or starts its turn in it. The area → <em>Drifts away</em>, 10 ft.</li>
          <li>Add to sheet. The cloud settles on the map, hits anyone who starts a turn in it, and drifts away from the caster each turn until concentration breaks.</li>
        </ol>
      </>
    )
  },
  {
    id: "features",
    label: "Features & Traits",
    content: (
      <>
        <p>
          Features and traits (Rage, Pack Tactics, Regeneration, Aura of Protection, Stench) open in the same{" "}
          <strong>ability editor</strong> as spells and attacks. Start one from <strong>Add ability → Start from scratch → Trait
          or feature</strong>, or from a recipe in <strong>Add ability</strong>: Rage, Reckless Attack, Action Surge, Cunning Action, Sneak Attack, Pack
          Tactics, Charge, Pounce, Rampage, Blood Frenzy, Magic Resistance, Legendary Resistance, Regeneration, Undead
          Fortitude, Stench, Fear Aura, Fire Aura, Heated Body, Aura of Protection and Evasion. The{" "}
          <a href="/docs/guides/zealot-barbarian">Zealot Barbarian guide</a> builds Rage with Divine Fury step by step.
        </p>

        <h3>The sections</h3>
        <ul>
          <li>
            <strong>Basics</strong> — listed as a feature or a trait (they work the same), and whether it&apos;s an
            optional rule: what an optional rule grants is only available while it&apos;s switched on.
          </li>
          <li>
            <strong>Use &amp; cost</strong> — <em>It works</em>: <strong>Always</strong> (Pack Tactics simply applies) or{" "}
            <strong>When switched on</strong> (Rage). Switched on, it takes an action, a bonus action, a reaction or
            nothing, spends from a limit (a pool such as <code>rage</code>, made here if the creature has none), and
            lasts a while. Switching between the two moves its effects to where they belong, and switching back brings
            back how it was switched on.
          </li>
          <li>
            <strong>While active</strong> — what it does, as cards that each read as a sentence. A feature that&apos;s
            switched on groups them by when they apply: <em>When it activates</em> (an extra action, a resource back)
            and <em>While it&apos;s active</em>. <strong>Add effect</strong> opens on a search: type what you&apos;re
            after (&ldquo;speed&rdquo;, &ldquo;resistance&rdquo;, &ldquo;tough&rdquo;, an item&apos;s name) and pick the
            effect, or one of its examples, which comes filled in. Without a search it shows the usual effects for what
            you&apos;re editing, then every kind in folds by what it changes: movement (speed, flying, ignoring difficult
            terrain), hit points (the maximum, regeneration, dropping to 1 HP instead of 0), scores, size and
            initiative, AC and defenses (resistances, damage reduction, Evasion), attacks and damage, spells, saves and
            d20 rolls, its turn, and class and monster mechanics. The{" "}
            <a href="/docs/guides/add-an-effect">Add an effect guide</a> walks through it. Speed, hit points and
            scores it changes show on Stats under the numbers you type. A bonus is a number or an ability modifier
            (Aura of Protection&apos;s Charisma), or so many for each level. A feature from an older save can list bonuses the simulator
            never applied: <strong>Make them effects</strong> turns them into cards it does.
            A card&apos;s <strong>When</strong> limits it (an ally next to the target, after a charge, while
            it&apos;s bloodied; with several picked, any one of them or all of them), <strong>While</strong> to the
            armor it wears, a shield, or one of its activations being on (Fast Movement: no heavy armor), and{" "}
            <strong>Which attacks</strong> to melee, ranged or spell attacks and the ability they use, with specific
            attacks and creature types under More options. A condition on its hits can be a <em>mark of its own</em> whose own cards say what it does, such
            as &ldquo;hits against it deal more&rdquo;.
          </li>
          <li>
            <strong>Aura</strong> — <em>Shares its effects with creatures nearby</em> (Aura of Protection: its allies,
            everyone or its enemies within a range, while it&apos;s conscious; the simulator shares save bonuses,
            advantage on saves and AC bonuses), and <em>Affects creatures nearby each round</em> (Stench, Fear Aura,
            Fire Aura: when a creature starts its turn near it, or at the start of its own turn; a save, damage and a
            condition, with immunity after a save and going quiet while it&apos;s incapacitated under More options).
          </li>
          <li>
            <strong>Grants</strong> — Dash, Disengage and Hide as bonus actions (Cunning Action), and abilities it
            grants: an attack after a charge (Pounce), an attack after it drops a creature (Rampage), or an attack,
            a save, a heal or a benefit of its own (Second Wind). Each opens in the editor, inside the feature&apos;s:
            the back button says where you are (<em>‹ Second Wind</em>), <strong>Done</strong> puts it back, and it&apos;s
            saved with the feature. An item&apos;s While active and Grants work the same way.
          </li>
          <li>
            <strong>Notes &amp; AI</strong> — reference text, and whether the simulator <em>uses it</em>, keeps it as{" "}
            <em>reference only</em>, or treats it as having <em>no combat effect</em> (Keen Smell). The last two switch
            its effects off in fights.
          </li>
        </ul>

        <h3>Shield, Parry and Counterspell</h3>
        <p>
          A spell or reaction that switches something on for a moment (Shield, a Parry) shows the same{" "}
          <strong>While active</strong>: how long it lasts and its cards (Shield&apos;s +5 AC). Counterspell and
          Protection do one thing (counter the spell, give the attack disadvantage), so they have none.
        </p>
        <p>
          Shield and Parry go off on <strong>An attack would hit it</strong>: once the attack is rolled and hits, before
          any damage, and only when the AC they give makes it miss. Nothing stops a critical hit. Under{" "}
          <strong>What it gives lasts</strong>, a Parry&apos;s +2 is <em>for that attack</em> and Shield&apos;s +5 lasts{" "}
          <em>until its next turn</em>. Creatures saved before this used to raise their AC as soon as an attack was aimed
          at them; they&apos;re brought up to date when they&apos;re loaded.
        </p>
        <p>
          Counterspell stops a spell no higher than the slot it&apos;s cast with. Above that it makes a check with its
          caster&apos;s spellcasting ability, DC 10 + the spell&apos;s level, and the slot is spent whether or not it
          works. A spell is the level of the slot it&apos;s cast with: Fireball with a 5th-level slot is a 5th-level
          spell. Under <strong>When</strong>, a counter&apos;s check can have a bonus of its own, or be switched off (then
          it can&apos;t stop anything above its slot).
        </p>
        <p>
          The AI counters what&apos;s worth countering: it weighs what the spell would do to its side if let through
          (damage across everyone it catches, who it would drop, the conditions it would land and for how long, less
          what it does to the caster&apos;s own side) against the slot it would spend, its chance of stopping it and its
          resource stance. The log says why it did or didn&apos;t. A campaign sets whether counterspellers{" "}
          <strong>know what&apos;s being cast and at whom</strong> (on its page, under Campaign rules). On, the default,
          they see the spell and its targets; off, as the rules are written, they only see that a spell is being cast,
          and weigh it by what the caster could cast. The Combat panel says which, when something there can counter.
        </p>

        <h3>What the AI does with them</h3>
        <p>
          The AI switches a feature on when it costs a bonus action and improves its attacks or defenses (Rage), and
          takes reactions when their trigger happens (Shield and Parry only when they turn a hit into a miss). It never
          switches on one that costs an action or nothing
          (Reckless Attack, Action Surge): use those by hand when you play the fight. The editor warns about this,
          and about anything that can&apos;t work where it is: an aura with nothing it can share, an extra action on a
          feature that&apos;s always on, or &ldquo;hits against it deal more&rdquo; on something that never ends.
        </p>

        <h3>Worked example: Pack Tactics</h3>
        <ol>
          <li>Abilities tab → Add ability → Start from scratch → Trait or feature. Name: <em>Pack Tactics</em>. Basics: Listed as → <em>Trait</em>.</li>
          <li>While active → Add effect → <em>Advantage on its attacks</em>. When → <em>an ally is next to the target</em>. Done.</li>
          <li>The preview reads <em>It has advantage on attack rolls if an ally is within 5 feet of the target.</em> Add to sheet.</li>
        </ol>
      </>
    )
  },
  {
    id: "items",
    label: "Items",
    content: (
      <>
        <p>
          A creature can carry <strong>items</strong>: a stack of potions, a scroll, a wand with charges, a flask to throw,
          a ring or a cloak that&apos;s always working. They&apos;re listed under <strong>Items</strong> on the Abilities
          tab, after Spellcasting, with how many each token has left. Add one from the library in{" "}
          <strong>Add ability</strong> (under Items: the Potions of Healing and the potions that help, a vial of acid and a
          flask of holy water, four wands, the Necklace of Fireballs, rings, a cloak and bracers, and items carried for
          reference until the simulator can run them), from a recipe there (a healing potion, a buff potion, a spell scroll,
          a wand, a thrown flask, a worn item, other gear), or from <strong>Start from scratch → Item</strong>. Each opens
          in the ability editor.
        </p>
        <p>
          A <strong>spell scroll</strong> is made from a spell: search <em>scroll</em> and the spell&apos;s name
          (<em>scroll fireball</em>), or choose the Spell scroll recipe. There&apos;s one of every library spell, and of
          each of the creature&apos;s own. Reading it casts the spell at the scroll&apos;s own save DC and attack bonus,
          which go by the spell&apos;s level (DC 13 and +5 up to 2nd level, up to DC 19 and +11 at 9th), and the scroll
          is gone.
        </p>
        <p>
          Under Items, <strong>Search Open5e items</strong> finds an item in Open5e. It&apos;s carried for reference: its
          text and where it came from, applied by hand (a weapon still attacks). When the library simulates an item of
          that name, the Abilities tab offers it: <em>The SRD&apos;s Potion of Healing is simulated. Use it</em> swaps it
          in, keeping how many there are. It&apos;s never swapped by itself, and two items of the same name from different
          documents each get their own offer.
        </p>

        <h3>Armor and shields</h3>
        <p>
          Armor and shields are items too. A worn suit of armor sets the creature&apos;s AC: its base AC, plus its
          Dexterity modifier (all of it for light armor, at most +2 for medium, none for heavy), plus its magic bonus (+1
          to +3). A worn shield adds +2 (and its magic) to that, or to the AC without armor. The AC typed on the Stats tab
          is the creature&apos;s AC <em>without armor</em> (natural armor, Unarmored Defense): with armor on, the Stats tab
          shows the AC the armor gives and its sum (<em>Chain Mail 16 + Shield 2</em>), and the typed AC moves to{" "}
          <em>Without armor</em>. A monster keeps its printed AC unless you give it armor.
        </p>
        <p>
          An armor row&apos;s <strong>Worn</strong> switch takes it off without deleting it: carried armor does nothing.
          Only the best suit and the best shield count, and the editor warns about a second. Heavy armor its wearer
          isn&apos;t strong enough for (a Strength score below its requirement) costs 10 ft of walking speed; disadvantage
          on Stealth is noted on the item, since there&apos;s no stealth in the simulator. Magic armor that needs attunement
          keeps its base AC unattuned; its bonus and properties need attunement. Rings, features and conditions (a Ring of
          Protection, Shield of Faith) still add on top. Adamantine armor&apos;s <em>no critical hits against it</em> is an
          effect any item or feature can have.
        </p>
        <p>
          Without armor, a feature, an item or a spell can work out the AC instead: the <em>AC without armor</em> effect is
          a base plus ability modifiers, used when it beats the typed AC. The library&apos;s Unarmored Defense is 10 +
          Dexterity + Constitution for a barbarian (a shield still adds) and 10 + Dexterity + Wisdom for a monk (not with
          a shield), Draconic Resilience 13 + Dexterity, and Mage Armor 13 + Dexterity, so it no longer adds +3 on top of
          armor or natural armor. An AC bonus can be <em>only with no armor and no shield worn</em>, as the Bracers of
          Defense&apos; is.
        </p>
        <p>
          The library has the SRD&apos;s armor (padded, leather and studded leather; hide, chain shirt, scale mail,
          breastplate and half plate; ring mail, chain mail, splint and plate) and the shield, magic shields +1 to +3, and
          magic armor: Elven Chain, Glamoured Studded Leather, mithral half plate and chain mail, Adamantine Plate, Dwarven
          Plate, Armor of Invulnerability, Dragon Scale Mail, Demon Armor and the Spellguard Shield. Any armor can be made
          +1 to +3 in its Armor section. Armor from Open5e comes in with its numbers and is simulated; magic armor from
          Open5e keeps its base and is marked partial, for you to add its bonus and properties.
        </p>

        <h3>The sections</h3>
        <ul>
          <li>
            <strong>Basics</strong> — what it is (a potion, a scroll, a wand, a thrown flask, a worn item, armor, a shield or gear), whether
            it&apos;s magic, and whether it <em>needs attunement</em>. An item that needs attunement does nothing until
            it&apos;s attuned; the sheet warns when a creature is attuned to more than three.
          </li>
          <li>
            <strong>Armor</strong> (armor and shields) — its weight (light, medium, heavy), its base AC (a shield&apos;s
            bonus), its magic bonus, the most Dexterity it adds (empty: its weight&apos;s), the Strength it needs,
            disadvantage on Stealth, and whether it&apos;s worn, with what it makes the creature&apos;s AC.
          </li>
          <li>
            <strong>Use &amp; cost</strong> — <em>how many</em> it carries (a potion, a scroll or a flask is used up one
            at a time) or its <em>charges</em> (a wand spends them and stays). For a potion, <em>what using it takes</em>:
            <em> the campaign&apos;s rule</em> (said there, with whether it can be given) or <em>its own</em> (what{" "}
            <em>drinking it</em> takes, what <em>giving it to a creature within 5 ft</em> takes or that it can&apos;t be
            given, and whether an action instead of a bonus action heals it in full).
          </li>
          <li>
            <strong>What it does</strong> — its uses, each opened in the editor inside the item&apos;s: a potion&apos;s
            heal or benefit, a flask&apos;s thrown attack, a wand&apos;s spell. Each spends one of the stack, or the
            charges it says.
          </li>
          <li>
            <strong>While carried</strong> — what it gives while it&apos;s carried (and attuned, if it needs to be): a
            Ring of Protection&apos;s +1 to AC and saving throws.
          </li>
          <li><strong>Notes &amp; AI</strong> — reference text, and whether the simulator uses it or keeps it for reference.</li>
        </ul>

        <h3>The campaign&apos;s potion rules</h3>
        <p>
          A campaign sets what <strong>drinking or giving a potion takes</strong> (on its page, under Campaign rules):
          an action (the 2014 rules, the default), a bonus action (the 2024 rules), or a bonus action to drink and an
          action to give. Every potion follows it unless its Use &amp; cost says it keeps its own timing; the library&apos;s
          potions follow it as they&apos;re added. A second rule, off by default: <strong>a healing potion used with an
          action instead of a bonus action heals in full</strong> (a Potion of Healing&apos;s 10, rather than 2d4 + 2;
          Greater 20, Superior 40, Supreme 60). It applies only where a bonus action would do, so it&apos;s greyed out
          under the 2014 rule, and under the house rule a potion given for an action is still rolled. A potion that heals
          a fixed amount, or doesn&apos;t heal, gets nothing from it. When someone carries a potion, the Combat panel
          says the rules in force (<em>Potions take a bonus action · an action instead heals a potion in full · campaign
          rules</em>), and a batch says which it ran with.
        </p>

        <h3>In a fight</h3>
        <p>
          A stack or charges is a resource, listed in the resource list with the creature&apos;s other pools: a fight
          spends it, <strong>Restart</strong> refills it, and a token can start with fewer (its <em>Left</em>). A potion is
          drunk, or given to a creature within 5 ft: pouring one into an ally who&apos;s down brings them back up. It&apos;s
          never given to the creature holding it, which drinks it instead.
        </p>
        <p>
          A wand casts its spell for a charge, and some cast it a level higher for each extra charge: a Wand of
          Fireballs&apos; 3 charges cast a 5th-level Fireball (10d6). Its hotbar button has a chip for each (<em>3 charges
          · 5th</em>), and the AI weighs each against the charges it spends. The Necklace of Fireballs throws one bead or
          several at once the same way. An item the simulator runs only in part (a Potion of Speed&apos;s AC, not its
          extra action) is marked on its row, which says what isn&apos;t simulated.
        </p>
        <p>
          The AI drinks a healing potion when it&apos;s likely to drop before its next turn and the potion would keep it
          up: it weighs every enemy that can reach it, how likely each one&apos;s attack is to land and what it deals, so a
          single hit for more than it has left counts even when the enemies together are expected to deal less. Bloodied,
          it drinks only when the action
          or bonus action has nothing better to do; a <em>liberal</em> creature also drinks whenever the heal won&apos;t
          be wasted, and a <em>conservative</em> one only to stay up. It gives a potion only to an ally who can&apos;t
          drink their own (down, or incapacitated), and a Healing Word that already reaches them beats walking over. A
          thrown flask is thrown when it beats the creature&apos;s weapon by more than the flask is worth. Using an item
          is priced as gone for good: a potion or a flask costs more to use than a charge, and a scroll at least a spell
          slot of its level. The log says why: <em>Kael chose to drink a Potion of Healing: 8 HP left, ≈10 damage likely
          before its next turn (2 in reach): 75% to drop, 25% after drinking</em>.
        </p>
        <p>
          With full healing for an action, the AI weighs its whole turn: attacking and drinking a rolled potion with its
          bonus action, or drinking the full amount with its action and using the bonus action for anything but another
          potion. It drinks in full when the full amount would keep it up and the roll likely wouldn&apos;t (4 HP against
          an ogre whose club hits for 13), and otherwise attacks and drinks with its bonus action. A downed ally gets the
          full amount for the action when a rolled potion would likely leave them to drop again; otherwise the rolled one
          for the bonus action, and the action still attacks.
        </p>
        <p>
          In Play, each item has a button in the hotbar&apos;s <strong>Items</strong> group, with how many are left, on
          the tab of what it takes: a potion&apos;s <em>Drink</em> is used at once, and <em>Give</em> is aimed at an ally
          within 5 ft, one who&apos;s down included. When drinking takes a bonus action and giving an action, the potion
          has a button on each tab (<em>Potion of Healing: Drink</em> under Bonus, <em>…: Give</em> under Actions). With
          full healing for an action, the Actions button has <em>Drink · full 10</em> and <em>Give · full 10</em>. A potion whose benefit lasts 10 minutes or more (Heroism) can be drunk before the fight:
          it&apos;s listed with the spells cast before it, in the Combat panel and on the Token tab, and ticking it spends
          one.
        </p>
        <p>
          The <strong>Battle report</strong> lists the items each creature used and the allies it got back up with one.
          A <strong>batch</strong> says how many of each item were used a fight (and how many of those for the full
          amount, with an action), in how many fights an item got a downed
          ally back up, and how often a creature went down still holding a healing potion it never drank: often means
          its stance, or the fight, never gave it the chance.
        </p>
      </>
    )
  },
  {
    id: "multiattack",
    label: "Multiattack & Extra Attack",
    content: (
      <>
        <p>
          A <strong>Multiattack</strong> is several attacks for one action, written the way a statblock prints it:{" "}
          <em>It can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws.</em>{" "}
          It opens in the <strong>ability editor</strong>, where its <strong>Sequence</strong> section is the routine, and
          it heads the creature&apos;s Actions. Start one from <strong>Add ability → Start from scratch → Multiattack</strong>. Every SRD
          monster&apos;s Multiattack is built this way already, and its preview reads like its statblock.
        </p>

        <h3>The routine</h3>
        <ul>
          <li>
            <strong>Steps</strong> — each is a count and what it uses: one of the creature&apos;s attacks (a weapon&apos;s
            stands for its power attack and charges too); <em>any melee</em>, <em>any ranged</em> or <em>any weapon
            attack</em>, where each swing picks its best one (the longsword beside an enemy, the longbow at range); or a
            save or area ability it uses along the way (a dragon&apos;s Frightful Presence; a breath is aimed at the
            routine&apos;s target). The arrows reorder the steps.
          </li>
          <li>
            <strong>Rules</strong> (a step&apos;s <em>⋯</em>) — who it can target: any creature (the AI spreads the
            swings), <em>a different creature</em> from the routine&apos;s other swings (a tyrannosaurus&apos;s tail), or{" "}
            <em>the previous attack&apos;s target</em>; and <em>only if the previous attack hit</em> (a grick&apos;s beak).
          </li>
          <li>
            <strong>Options</strong> — <em>…or another routine</em> adds one it can make instead, with a label
            (<em>…or two ranged attacks</em>). <em>Replace one attack with…</em> adds the routine with one swing
            swapped (a wight&apos;s Life Drain in place of one longsword attack), and the preview reads it that way.
          </li>
          <li>
            <strong>One weapon per Attack action</strong> — with <em>any</em> steps, holds every swing to the same
            weapon. Off, a creature can draw or drop a weapon between attacks, as the rules allow.
          </li>
          <li>
            <strong>Damage vs AC</strong> — each routine&apos;s average damage a round against a typical AC for the
            creature&apos;s challenge rating or level (change it to compare), and each step&apos;s reach.
          </li>
          <li>
            <strong>Not simulated</strong> (under More) — statblock sentences the routine leaves out, one a line (a
            hydra&apos;s heads, a roper&apos;s Reel). The preview shows them apart.
          </li>
          <li>
            <strong>Use &amp; cost</strong> — an action, or a bonus action that spends from a pool: Flurry of Blows
            (below).
          </li>
        </ul>
        <p>
          Warnings point at the Sequence when a step can&apos;t happen: an ability the creature no longer has, one the
          simulator doesn&apos;t run, <em>any ranged attack</em> with no ranged attack to make, or a first attack that
          waits on &ldquo;the previous attack&rdquo;.
        </p>

        <h3>How it plays</h3>
        <p>
          The AI takes the routine (or option) worth the most from where it stands, then makes its swings one at a
          time. Each swing picks its attack and a target within that attack&apos;s own reach, so a dragon bites a
          creature 10 ft away and claws the one beside it, and a power attack goes only on the swings where it pays.
          When a target drops, the next swing goes to someone else in reach, or the creature moves with the movement
          it has left and finishes the routine there; moving out of an enemy&apos;s reach provokes opportunity attacks
          as usual. An option that needs a spent ability (a breath that hasn&apos;t recharged) isn&apos;t offered.
          Reach counts from a creature&apos;s top-left square, so a big creature&apos;s reach is short on its far sides.
        </p>

        <h3>Extra Attack</h3>
        <p>
          Add <strong>Extra Attack</strong> from the library (<strong>Add ability</strong>, search <em>extra attack</em>, then its{" "}
          <strong>+</strong>). It grants a routine of
          two <em>any weapon attack</em> swings, so swapping a weapon breaks nothing. For a fighter&apos;s third
          attack at 11th level, open the feature, then <strong>Grants → Extra Attack</strong>, and make it three.
        </p>

        <h3>Deleting what a routine uses</h3>
        <p>
          Deleting an ability a routine uses asks first, and says what the routine is left with.{" "}
          <strong>Replace it with</strong> keeps the routine whole: its steps use another attack, or any attack of a
          kind, instead. Either way it&apos;s one undo step.
        </p>

        <h3>Worked example: Flurry of Blows</h3>
        <ol>
          <li>Abilities tab → Add ability → Start from scratch → Multiattack. Name: <em>Flurry of Blows</em>.</li>
          <li>Sequence: the step → <em>2</em> × the monk&apos;s unarmed strike.</li>
          <li>Use &amp; cost: Takes → <em>Bonus action</em>; Limit → <em>Pool</em> → a new pool, <code>ki</code>, the size of the monk&apos;s ki points.</li>
          <li>Add to sheet. It&apos;s listed under Bonus actions, and the AI uses it after its attacks while it has ki.</li>
        </ol>
      </>
    )
  },
  {
    id: "zones",
    label: "Zones & Persistent Effects",
    content: (
      <>
        <p>
          A handful of spells leave a persistent zone on the battlefield instead of resolving instantly.
          There's no separate "zone builder" — casting one of these spells creates the zone automatically, and
          it's simulated every turn until it expires. A few patterns show up in the built-in spell library:
        </p>
        <ul>
          <li>
            <strong>Cloudkill</strong> — the zone automatically drifts a set distance away from the caster
            each of the caster's turns.
          </li>
          <li>
            <strong>Spike Growth</strong> — anything that moves through the zone takes automatic damage per
            square of movement, and the AI accounts for this when deciding whether to path through it.
          </li>
          <li>
            <strong>Moonbeam</strong> — the caster can spend a bonus action to reposition the zone rather than
            it moving on its own.
          </li>
          <li>
            <strong>Web / Insect Plague–style zones</strong> — terrain-only effects (difficult terrain,
            vision-blocking) with no direct damage.
          </li>
        </ul>
        <p>
          While a token is standing inside an active zone, it gets a visible highlight on the map so it's
          obvious at a glance who's currently affected.
        </p>
      </>
    )
  },
  {
    id: "play",
    label: "Playing a Fight by Hand",
    content: (
      <>
        <p>
          <strong>Play</strong>, in the Combat panel, runs a fight the way you'll run it at the table: you play the
          sides you choose, turn by turn, and the AI plays the rest. Everything goes through the same rules the
          simulator uses, so what you see is what the AI would have to deal with. There's a walkthrough in the{" "}
          <a href="/docs/guides/play-a-fight-by-hand">Play a fight by hand</a> guide.
        </p>
        <h3>Starting</h3>
        <ul>
          <li>
            <strong>Who plays each side</strong>: <em>You</em> or <em>AI</em>. A creature can be handed to the other
            player from its row in the initiative list (the You/AI chip); a dominated creature is played by whoever
            plays its dominator, a summon by whoever plays its summoner.
          </li>
          <li>
            <strong>Ask before my creatures react</strong> (and the same for opportunity attacks): on, every reaction
            your creatures could take is asked about. Off, the AI decides those you haven't set yourself.
          </li>
          <li>
            <strong>How the AI's turns play out</strong>: at 1×, 2× or 4× on the map, or instantly. Skip jumps to your
            next turn.
          </li>
          <li>
            <strong>Start</strong> keeps the board as it is as the fight's setup, for <em>Reset to setup</em>.
          </li>
        </ul>
        <h3>Your creature's turn</h3>
        <ul>
          <li>
            <strong>The hotbar</strong>, at the bottom of the map, shows what's left of the turn and everything the
            creature can use, by what it takes: <strong>Actions</strong> (free ones too, like Action Surge),{" "}
            <strong>Bonus</strong> and <strong>Reactions</strong>. Inside a tab the buttons are grouped by what they
            are: Attacks, Spells (with the slots left), Features, Items and Common (Dash, Disengage, Dodge…). Each is
            coloured by what it is: attacks red, features gold, items teal, common actions grey, and a spell by its
            element (fire orange, radiant pale gold, healing green, or its school&apos;s colour when it deals no damage).
            A corner mark says what it takes: a green ● for an action, an orange ▲ for a bonus action, a hollow ◇ for
            free. A button greyed out says why. Keys 1–0 press the tab's first ten.
          </li>
          <li>
            <strong>Moving</strong>: the squares it can still reach are tinted; over a square, the route, its cost,
            the squares that cost double, hazards on the way, and who gets an opportunity attack where. Click to go
            there, Shift-click to plan a stop on the way (Esc or right-click takes it back), or drag the token.
          </li>
          <li>
            <strong>Aiming</strong>: an armed ability tints its range and rings the creatures it can be aimed at;
            over one, it says the chance to hit or to fail the save and the damage, or why it can't. An area follows
            the cursor and rings who it catches, friends included. Esc puts it away; Enter uses it on the creatures
            picked so far.
          </li>
          <li>
            <strong>Variants</strong> sit under their ability: the slot to cast at, Power Attack, spend a charge.
          </li>
          <li>
            <strong>Attacking</strong>: there's no Extra Attack or Multiattack button. Press a weapon (or a claw, a
            bite): the first swing takes the Attack action or the Multiattack, and the swings left stay on the weapon
            buttons for the rest of the turn (<em>⚔ 1 left</em>, and <em>Attack · 1 left</em> on the Action pill).
            Move, use a bonus action or drink a potion between them; Undo takes back one swing. A routine&apos;s rules
            hold: an owlbear&apos;s second claws is greyed out, a tyrannosaurus&apos;s tail won&apos;t go at the
            bite&apos;s target, a grick&apos;s beak follows only a tentacle hit. Frightful Presence or Breath Weapon in
            place of an attack is a swing too. A routine that costs more than its action (Flurry of Blows) has a button
            of its own, and its second strike rides the strike&apos;s button. Swings left unused when the turn ends are
            skipped.
          </li>
          <li>
            <strong>By hand</strong>: an ability the simulator doesn't run takes its slot and its cost and is logged;
            you apply what it does.
          </li>
          <li>
            <strong>End turn</strong> (or Enter), <strong>AI: take this turn</strong>, and <strong>Undo</strong>,
            which takes back your last command (or an End turn and the AI turns after it). The same command again
            rolls the same dice.
          </li>
        </ul>
        <h3>Questions</h3>
        <p>
          When one of your creatures can react — an opportunity attack, Shield, Parry, Hellish Rebuke, Protection,
          Counterspell — or use Legendary Resistance, a card asks, with the numbers: the roll against the AC, the
          chance to hit, the slot it spends. Each reaction's card sets how it's handled for the rest of the fight:{" "}
          <em>Ask</em>, <em>Always</em> or <em>Never</em> (the hotbar's Reactions tab shows and changes the same).
          A question during the AI's turn waits until its playback gets there. A legendary creature you play is
          asked after each other creature's turn, and a lair you play on initiative 20; options the simulator can't
          run are taken by hand.
        </p>
        <h3>The DM's hand</h3>
        <p>
          Right-click a token for its HP, temporary HP, conditions and its reaction back; Alt-drag it to put it
          anywhere; right-click a door to open or close it. In a played fight each of these is logged as the DM's,
          so the battle report counts them and a replay shows them.
        </p>
        <h3>Overruling a roll</h3>
        <p>
          The rolls made since your last command sit under the turn banner, newest first: who rolled, the total
          against the AC or DC, and how it came out. A roll's <strong>⋯</strong> rules it the other way (a hit, a
          critical hit or a miss; a save, a check or a death save made or failed; a recharge or not), and the same ⋯
          is on its entry in the Combat log. The step it was rolled in runs again with the roll as ruled, and
          everything after plays out again from there: the number rolled stays and the log marks it{" "}
          <em>DM override</em>, a question after it is asked again if it still comes up, and the dice after it can
          fall differently (a hit rolls damage a miss didn&rsquo;t). A card that shows a roll, like Shield&rsquo;s,
          has its own <strong>Overrule the roll…</strong>. Undo puts the roll back the way it came out; the battle
          report counts the rolls overruled.
        </p>
        <h3>The end</h3>
        <ul>
          <li>
            <strong>Battle report</strong>, <strong>Save this run</strong> (kept with the scene, marked as played by
            hand), <strong>Reset to setup</strong> or <strong>Keep the board</strong>.
          </li>
          <li>
            <strong>Odds from here</strong>, in the Combat panel, lets the AI play the rest of the fight from the
            board as it stands, 100 times over.
          </li>
          <li>
            A fight in progress survives a reload. Saving the scene while playing saves its setup, not the
            half-fought board.
          </li>
        </ul>
      </>
    )
  },
  {
    id: "traits",
    label: "Monster Traits, Legendary & Lair Actions",
    content: (
      <>
        <p>
          Library monsters come with their traits already wired up, and you can give any creature the same
          abilities from the recipes in <strong>Add ability</strong> on its Abilities tab, or copy one straight from a library monster there. Each trait row says in plain words what it
          does in a fight — &ldquo;charge 20 ft: +1d6 slashing, STR 11 or prone&rdquo;, &ldquo;aura 10 ft: CON 14 or
          poisoned, at the start of their turn&rdquo;. Traits with nothing to simulate (Keen Smell, Amphibious) carry a
          quiet <strong>no combat effect</strong> badge rather than looking like something is missing.
        </p>

        <h3>Charges and pounces</h3>
        <ul>
          <li>
            <strong>Charge / Trampling Charge / Pounce</strong> — if the creature closes at least 20 ft (or the distance
            you set) straight toward a target and then hits it with the named attack that turn, the extra damage lands
            and the target saves or is knocked prone. A detour around a wall doesn&apos;t count: it has to get that much
            closer. Pounce and Trampling Charge then allow a bonus-action attack against the prone target. The AI knows
            this: a lion with room to run leads with its claw, not its (harder-hitting) bite.
          </li>
          <li><strong>Rampage</strong> — after dropping a creature with a melee attack, it moves (up to half its speed) and bites the next foe as a bonus action.</li>
          <li><strong>Blood Frenzy</strong> — advantage on melee attacks against anything missing hit points.</li>
          <li><strong>Surprise Attack / Sneak Attack / Martial Advantage</strong> — extra damage against a surprised target, with advantage or an ally beside the target, or with an ally beside the target (once per turn).</li>
          <li><strong>Aggressive / Cunning Action</strong> — a bonus-action Dash (and Disengage or Hide): the AI closes the gap and still attacks.</li>
        </ul>
        <p>
          A creature knocked prone gets up at the start of its next turn, which costs it half its movement (unless it&apos;s
          grappled or restrained and can&apos;t move).
        </p>

        <h3>Auras and retaliation</h3>
        <ul>
          <li><strong>Stench, Fear Aura</strong> — a creature that starts its turn close by makes a save or is poisoned (or frightened) until the start of its next turn; a creature that saves is immune for the rest of the fight.</li>
          <li><strong>Fire Aura</strong> — at the start of the bearer&apos;s own turn, everything next to it burns.</li>
          <li><strong>Heated Body, Corrosive Form</strong> — hitting the creature with a melee attack from within 5 ft hurts the attacker.</li>
          <li><strong>Death Burst, Death Throes</strong> — the creature explodes when it dies.</li>
          <li><strong>Evasion</strong> — a Dexterity save for half damage takes none on a success and half on a failure.</li>
        </ul>
        <p>
          To build your own, start from a recipe in <strong>Add ability</strong> (Stench, Fear Aura, Fire Aura, Heated Body, Charge,
          Pounce, Rampage) or a blank feature: <em>Affects creatures nearby each round</em> in its Aura section (when,
          reach, who, save, damage, condition), <em>Hurts what hits it in melee</em> in While active, and an attack after a
          charge or after it drops a creature in Grants. See <a href="#features">Features &amp; Traits</a>.
        </p>

        <h3>Legendary actions</h3>
        <p>
          Add one with <strong>Add ability → Start from scratch → Legendary action</strong>, or copy one from a library
          monster in Add (one that uses its monster&apos;s tail attack comes with that attack as its own). Each lists under{" "}
          <strong>Legendary actions</strong>, with how many the creature takes a round beside the heading. In the editor:
        </p>
        <ul>
          <li>
            <strong>Use &amp; cost</strong> — what it costs (1, 2 or 3 actions) and how many the creature takes a round
            (3 for most, shared by all of them; Resources, above the list, changes it too).
          </li>
          <li>
            <strong>Does</strong> — it uses one of the creature&apos;s abilities as it is (a dragon&apos;s Tail Attack is its
            tail attack), has an ability of its own set in the sections below (Wing Attack: a save around itself), or is
            reference text you resolve (Detect). Switching keeps the others while the editor is open, and its own ability
            starts as a copy of the one it used.
          </li>
        </ul>
        <p>
          At the end of another creature&apos;s turn, a legendary creature with actions left takes the best one that
          reaches a target; they all come back at the start of its own turn. The AI only takes legendary actions that
          attack, call for a saving throw or make a multiattack, and the editor says so for any other. Deleting an
          ability a legendary action uses asks first: pick another for it, or it becomes reference text.
        </p>

        <h3>On death</h3>
        <p>
          Add one with <strong>Start from scratch → On death</strong>, or the <em>Death burst</em> recipe (a gas spore&apos;s
          poison). It fires once, when the creature drops to 0 hit points, as an area around it: a sphere or a cube,
          everyone in it or only its enemies, with the save, damage and effects of any area. Nobody aims it, so there are
          no cones or lines, and the simulator only runs one that calls for a saving throw.
        </p>

        <h3>Lair actions</h3>
        <p>
          Add one with <strong>Start from scratch → Lair action</strong>: an attack, a save or an area, the only kinds a
          lair takes. Then mark the token <strong>In its lair</strong> from its right-click menu or the sheet&apos;s Token
          tab, under This fight (the row shows once the creature has a lair action). Each round, on initiative 20 (after
          anyone who rolled 20 or more), it takes one of its lair actions — never the same one two rounds running —
          without spending any of its own actions. The initiative tracker shows the slot as a
          dashed <em>Lair actions · 20</em> row, and the combat log reads &ldquo;Lair action (initiative 20): …&rdquo;. The SRD
          statblocks don&apos;t include lair actions, so these are yours to write.
        </p>
      </>
    )
  },
  {
    id: "editions",
    label: "Editions (2014 & 2024)",
    content: (
      <>
        <p>
          The library has both editions of the rules side by side: the 2024 ones (System Reference Document 5.2) and
          the 2014 ones (System Reference Document 5.1). There&apos;s no edition setting for a campaign or an
          encounter. Each class, subclass, race or species, background, feat and spell says which rules it&apos;s
          written for, and the simulator plays it by them: a 2014 Fighter can cast a 2024 spell, and a 2014
          Counterspell and a 2024 one can meet in the same fight.
        </p>

        <h3>The lists</h3>
        <p>
          Where both editions have something, its rows carry a <strong>2014</strong> or <strong>2024</strong> badge, and
          the list has a <strong>2014 · 2024 · Both</strong> filter, remembered for each list. A single edition hides
          only the other edition&apos;s version of what both have (so the 2014-only weapons stay listed under 2024), and
          never hides homebrew or what&apos;s already chosen. A built character&apos;s builder opens on its own edition.
          In a select whose entry has a namesake in the other edition, the name says which: <em>Fighter (2014)</em>.
        </p>

        <h3>Building a 2014 character</h3>
        <ul>
          <li>
            <strong>Ability increases from</strong> the background or the race: a 2014 race has its own (a Hill
            Dwarf&apos;s +2 Constitution and +1 Wisdom); a 2024 background has three points. Mixing them, the character
            takes one set, never both: the background&apos;s by default when it has them, and you can switch.
          </li>
          <li>
            The 2014 rules come with the 2014 class: an Ability Score Improvement at 19th level instead of an Epic
            Boon, spells prepared by modifier and level (a cleric, a druid, a wizard; a paladin by half its level),
            no slots before 2nd level for a paladin or ranger, and starting equipment chosen line by line.
          </li>
          <li>
            A character can&apos;t have both editions&apos; versions of a class. <strong>Rebuild with the
            builder</strong> matches a hand-built character&apos;s classes in the edition the filter shows.
          </li>
          <li><strong>Quick party</strong> takes its classes from the edition the filter shows, and any mix with Both.</li>
        </ul>

        <h3>Add ability</h3>
        <p>
          Add ability lists both editions&apos; spells (the 2014 ones the simulator doesn&apos;t cast only for a
          search), and the 2024 class features, at the class level you set in the panel, for a monster or a homebrew
          actor.
        </p>

        <h3>Table rules</h3>
        <p>
          A few rules belong to no class or spell, so the campaign sets them, beside the potion rules: being
          <strong> grappled</strong>, being <strong>stunned</strong> and being <strong>surprised</strong>, each 2014 or
          2024. Each defaults to how the simulator always played it. The Combat panel names the rule in force where it
          matters.
        </p>

        <h3>What runs</h3>
        <p>
          Most 2014 features run as their 2024 namesakes do, and the ones that differ run by the 2014 rules: the 2014
          Rage, Brutal Critical, Divine Smite as a feature, Wild Shape into a beast&apos;s own hit points, Destroy Undead
          and so on. A feature that runs only in part says on the sheet what isn&apos;t simulated, and one the
          simulator can&apos;t run is there as its text for you. The project&apos;s
          <code> src/data/srd/2014/COVERAGE.md</code> lists every 2014 feature and race trait with what it does.
        </p>

        <h3>Homebrew</h3>
        <p>
          Each homebrew entry has a <strong>Rules</strong> field. A 2014 class has its 19th-level Ability Score
          Improvement; its spellcasting can prepare by modifier and level, start its slots at 2nd level, and round its
          levels down when multiclassed. The spell picker and the spell lists offer both editions.
        </p>
      </>
    )
  },
  {
    id: "credits",
    label: "Credits & Licensing",
    content: (
      <>
        <p>
          The built-in library of monsters, spells, weapons and features is based on the System Reference
          Document 5.1, and the character builder&apos;s classes, species, backgrounds and feats on the System
          Reference Document 5.2 (the 2024 rules) and 5.1 (the 2014 rules). Both are provided under the Creative Commons
          Attribution 4.0 International License.
          BattleSim is compatible with fifth edition.
        </p>
        <SrdAttribution />
        <TokenIconCredits />
        <p>
          Token art you import for SRD monsters stays in your browser on this device: it isn&apos;t uploaded, saved
          with your actors, or shown to anyone else.
        </p>
      </>
    )
  }
];

export function DocsPage({ guides = [] }: { guides?: GuideSummary[] }) {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const top = visible.reduce((best, entry) => (entry.boundingClientRect.top < best.boundingClientRect.top ? entry : best));
        setActiveId(top.target.id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );
    for (const section of SECTIONS) {
      const el = sectionRefs.current[section.id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <BookOpen size={16} />
        <h1>BattleSim Docs</h1>
        <div className={styles.spacer} />
        <a href="/campaigns">
          <LayoutGrid size={14} /> Campaigns
        </a>
        <a href="/">
          <Swords size={14} /> Sandbox
        </a>
      </div>

      <div className={styles.layout}>
        <nav className={styles.nav}>
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={section.id === activeId ? styles.navItemActive : styles.navItem}
            >
              {section.label}
            </a>
          ))}
          {guides.length > 0 && <span className={styles.navHeading}>Guides</span>}
          {guides.map((g) => (
            <a key={g.slug} href={`/docs/guides/${g.slug}`} className={styles.navItem}>
              {g.title}
            </a>
          ))}
        </nav>

        <main className={styles.content}>
          {SECTIONS.map((section) => (
            <section
              key={section.id}
              id={section.id}
              ref={(el) => {
                sectionRefs.current[section.id] = el;
              }}
              className={styles.section}
            >
              <h2>{section.label}</h2>
              {section.content}
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
