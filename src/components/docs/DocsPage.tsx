"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, LayoutGrid, Swords } from "lucide-react";
import type { GuideSummary } from "@/lib/guides";
import { SrdAttribution } from "./SrdAttribution";
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
            from the Combat panel.
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
          selection) or the sheet&apos;s Token tab. An airborne token floats over a shadow with its height on
          a badge.
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
          Every token on the board — player character or monster — has an actor sheet behind it, split into
          tabs:
        </p>
        <ul>
          <li>
            <strong>Stats</strong> — ability scores, AC, HP, speed, proficiency bonus, saving throws, skills,
            resources such as spell slots, and the spellcasting ability its spells follow.
          </li>
          <li>
            <strong>Abilities</strong> — the attacks, spells, and features this actor can use in combat.
          </li>
          <li>
            <strong>Tactics</strong> — the AI behavior profile that decides how this actor plays (who it
            targets, how aggressively it uses resources).
          </li>
          <li>
            <strong>Token</strong> — the on-map instance data: position and token image, kept separate from
            the reusable sheet so the same actor definition can be dropped onto multiple maps.
          </li>
        </ul>
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
            <strong>Spellcasting</strong> gives the actor&apos;s spellcasting ability, save DC and attack bonus, then its spells by
            level with the slots it has left.
          </li>
          <li>
            <strong>The pools</strong> above the list show what it has to spend: a breath that&apos;s ready or recharging, uses and
            pools (rage, ki, a weapon&apos;s charges), and legendary actions a round. Click them to change what this token has
            left and the full size every fight starts with.
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
          You can build an actor by hand on the Abilities tab, or drop in a
          ready-made creature from the SRD/Open5e compendium and adjust it from there. Actors also carry a{" "}
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
          weapons, spells, monster abilities, traits and features, and recipes. Enter takes the first thing found; Esc clears
          the search, then closes it.
        </p>
        <ul>
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
            its reach, or something described. With a slot, <strong>Stronger with a higher slot</strong> adds dice,
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
          A weapon&apos;s Basics can make it <strong>a focus or wand</strong> (a staff, a holy symbol): it makes no attack
          of its own, so it has no Target, Roll or Damage, only its charges (Use &amp; cost), what it does while carried
          (While active) and what it lets the creature use (Grants), each opened in the editor with a breadcrumb
          (<em>Staff of Fire › Fireball</em>).
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
          <li>Add to sheet. Give the caster <code>slot-3</code> (and higher, to upcast) on its Stats tab; the editor warns until it has them.</li>
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
            and <em>While it&apos;s active</em>. <strong>Add effect</strong> lists every kind, grouped by what it
            changes: its attacks (advantage, a bonus to hit, extra damage, damage with a save, a condition on its hits,
            swarm damage), its defense (attacks against it, AC, a resistance, immunity or vulnerability or absorbing a
            damage type as healing, Evasion, hurting what hits it in melee), saving throws, staying alive
            (regeneration, dropping to 1 HP instead of 0, splitting) and its turn. A bonus is a number or an ability
            modifier (Aura of Protection&apos;s Charisma). A feature from an older save can list bonuses the simulator
            never applied: <strong>Make them effects</strong> turns them into cards it does.
            A card&apos;s <strong>When</strong> limits it (an ally next to the target, after a charge, while
            it&apos;s bloodied; with several picked, any one of them or all of them) and <strong>Which attacks</strong>{" "}
            limits it to melee, ranged or spell attacks and the ability they use, with specific attacks under More
            options. A condition on its hits can be a <em>mark of its own</em> whose own cards say what it does, such
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

        <h3>What the AI does with them</h3>
        <p>
          The AI switches a feature on when it costs a bonus action and improves its attacks or defenses (Rage), and
          takes reactions when their trigger happens. It never switches on one that costs an action or nothing
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
            (3 for most, shared by all of them; the pools above the list change it too).
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
          lair takes. Then mark the token <strong>In its lair</strong> from its right-click menu or the Token tab. Each
          round, on initiative 20 (after anyone who rolled 20 or more), it takes one of its lair actions — never the same
          one two rounds running — without spending any of its own actions. The initiative tracker shows the slot as a
          dashed <em>Lair actions · 20</em> row, and the combat log reads &ldquo;Lair action (initiative 20): …&rdquo;. The SRD
          statblocks don&apos;t include lair actions, so these are yours to write.
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
          Document 5.1, which is provided under the Creative Commons Attribution 4.0 International License.
          BattleSim is compatible with fifth edition.
        </p>
        <SrdAttribution />
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
