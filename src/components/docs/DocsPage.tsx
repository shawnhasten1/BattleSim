"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, LayoutGrid, Swords } from "lucide-react";
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
            <a href="#walls">Walls &amp; the Battle Map</a>).
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
          Inside a campaign, create an encounter to get a fresh map and roster. Opening an encounter drops
          you into the main editor, which is made up of a few areas:
        </p>
        <ul>
          <li>
            <strong>Top bar</strong> — switch scenes, open the Encounter Builder, undo/redo, save, reset the
            encounter, view the battle report, and scene settings.
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
    label: "Walls & the Battle Map",
    content: (
      <>
        <p>
          The battle map is a grid you can drop a background image onto and then build out with walls and
          terrain using the left tool rail.
        </p>
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
        <p>
          Besides walls, you can paint <strong>terrain</strong> onto grid cells — normal, difficult (costs
          extra movement), impassable, hazardous, or terrain that grants cover/elevation. Terrain painted this
          way is permanent for the encounter, as opposed to the temporary zones spells create (see{" "}
          <a href="#zones">Zones &amp; Persistent Effects</a>).
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
            <strong>Stats</strong> — ability scores, AC, HP, speed, proficiency bonus, saving throws and
            skills.
          </li>
          <li>
            <strong>Actions</strong> — the attacks, spells, and features this actor can use in combat.
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
          You can build an actor by hand using the form-based builders on the Actions tab, or drop in a
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
          This section is a full walkthrough of the spell builder — every field, what it means, and how the
          pieces fit together. If you just want the short version: open an actor's <strong>Actions</strong>{" "}
          tab, hit <strong>Add</strong>, and either drop in something ready-made or start blank and follow the
          form top to bottom.
        </p>

        <h3>Three ways to put a spell on a sheet</h3>
        <p>Click <strong>Add</strong> on the Actions tab to open a popover with four tabs:</p>
        <ul>
          <li>
            <strong>Library</strong> — search the built-in SRD spell list and click (or drag onto the sheet)
            to attach one as-is, fully simulated.
          </li>
          <li>
            <strong>Preset</strong> — a handful of common shapes (damage cantrip, save-or-condition spell,
            area blast, healing, reaction spell) pre-filled as a starting point you then edit.
          </li>
          <li>
            <strong>Blank</strong> — an empty spell, built entirely by hand in the builder form. This is what
            the rest of this section walks through.
          </li>
          <li>
            <strong>Import</strong> — search the Open5e compendium and pull in a spell by name. This attaches
            it as a <em>reference</em> — its text is there for you to read, but it isn't compiled into
            simulateable damage/save/area data, so the AI won't actually cast it. Treat it as a head start:
            open it afterward and fill in the Blank-style fields if you want it to actually fire in combat.
          </li>
        </ul>
        <p>
          Whichever way you start, editing opens the same builder form. It has a{" "}
          <strong>Simple / Advanced</strong> toggle near the top of the Actions tab — Simple hides the
          fields most spells don't need (concentration, ritual, resource cost, upcast, beam count, zone
          behavior, DC override); Advanced reveals all of it. The toggle is remembered in your browser, not
          per-spell, so flip it to Advanced any time a field mentioned below seems to be missing.
        </p>

        <h3>The core fields</h3>
        <ul>
          <li><strong>Name</strong> — whatever you want it called on the sheet.</li>
          <li><strong>Spell level</strong> — 0 for a cantrip, 1–9 otherwise. This drives upcasting (below).</li>
          <li>
            <strong>Timing</strong> — Action, Bonus action, or Reaction. Choosing Reaction reveals a trigger
            block: what has to happen for it to fire (an enemy casts a spell nearby, you're hit by an attack,
            and so on), who it acts on, and how eagerly the AI spends it — see the same reaction-trigger
            picker described for weapons.
          </li>
          <li>
            <strong>Range (ft)</strong> — a number, or the words <code>self</code> / <code>touch</code>.
          </li>
        </ul>

        <h3>What it does — the four shapes</h3>
        <p>
          The <strong>What it does</strong> field picks the spell's shape, and everything below it in the
          form changes to match:
        </p>

        <p><strong>Attack roll</strong> — rolls to hit against the target's AC, like a weapon attack.</p>
        <ul>
          <li><strong>Spell attack uses</strong> — the ability that drives the attack bonus (INT/WIS/CHA for most casters).</li>
          <li><strong>Damage</strong> — dice, die size, flat bonus, and damage type.</li>
          <li>
            <strong>Delivery</strong> (Advanced) — Single, or Multiple beams for something like Magic Missile
            or Scorching Ray. Beams reveals <strong>Number of beams</strong> and <strong>Always hits</strong>{" "}
            (skips the attack roll entirely — each beam's damage just lands).
          </li>
          <li><strong>Effects</strong> — optional riders on top of the damage; see below.</li>
        </ul>

        <p><strong>Saving throw (one target)</strong> — the target rolls a save instead of you rolling to hit.</p>
        <ul>
          <li><strong>Saving throw</strong> — which ability the target saves with.</li>
          <li>
            <strong>Save DC</strong> (Advanced) — leave it blank and the engine auto-calculates it from the
            caster's spellcasting stat; only set a number here to hardcode it.
          </li>
          <li><strong>On a successful save</strong> — Half damage, No damage, or Effect negated.</li>
          <li><strong>Deals damage</strong> — toggle on to reveal the damage dice (a spell can be pure save-or-condition with this off).</li>
          <li><strong>Effects</strong> — riders, usually gated on a failed save.</li>
        </ul>

        <p><strong>Saving throw (area)</strong> — everything above, plus a template you place on the map:</p>
        <ul>
          <li><strong>Shape</strong> — Circle, Cone, Line, Rectangle, or Square.</li>
          <li><strong>Radius (ft)</strong> — circle radius / cone or line length / rectangle length.</li>
          <li><strong>Width (ft)</strong> — line and rectangle only.</li>
          <li><strong>Centred on</strong> — a point you choose within range, or the caster.</li>
          <li><strong>Aimed from the caster</strong> — cones/lines/rectangles point from the caster toward the spot you pick.</li>
          <li><strong>Affects</strong> (Advanced) — Enemies only, or everyone standing in the area.</li>
          <li>
            <strong>Leaves a persistent zone</strong> (Advanced) — turns this from a one-shot burst into a
            standing area like Cloudkill or Web; see <a href="#zone-builder">turning an area spell into a
            zone</a> below.
          </li>
        </ul>

        <p><strong>Healing</strong> — restores hit points instead of dealing damage.</p>
        <ul>
          <li><strong>Healing</strong> — dice, plus an option to add the caster's ability modifier.</li>
          <li><strong>Heals</strong> — one creature you target, or the caster.</li>
        </ul>

        <h3>Effects (riders)</h3>
        <p>
          Any damage-dealing shape has an <strong>Effects</strong> field — a list of secondary effects on top
          of the spell's main damage/save. Click <strong>+ Add effect</strong> and pick a kind:
        </p>
        <ul>
          <li>
            <strong>Condition</strong> — applies a condition (frightened, poisoned, paralyzed, etc.). For a
            save-based spell it's automatically gated on your existing save; for an attack it can optionally
            require its own separate save. Set a <strong>Duration</strong>: a number of rounds, until the
            target saves again, while you concentrate, until the target's next turn, or permanent until
            something removes it.
          </li>
          <li><strong>Extra damage</strong> — bonus damage dice on top of the main hit.</li>
          <li><strong>Push</strong> — shoves the target a set distance.</li>
          <li><strong>Reference note</strong> — plain text for an effect you'll resolve by hand; not simulated.</li>
        </ul>
        <p>
          Every rider (except a reference note) has a <strong>Triggers</strong> setting — on a hit / on a
          crit / always for weapon-style contexts, or on a failed save / on a successful save / always for
          save-based ones — plus an optional <strong>creature-type restriction</strong>: check it and tick
          specific types (undead, fiend, etc.) and the rider silently does nothing to any target outside that
          list, while the spell's main attack or save still resolves normally against them.
        </p>

        <h3 id="zone-builder">Turning an area spell into a persistent zone</h3>
        <p>
          With <strong>Saving throw (area)</strong> selected and Advanced mode on, toggle{" "}
          <strong>Leaves a persistent zone</strong> to make the area stick around instead of resolving once.
          This is exactly how Cloudkill, Spike Growth, Web, Insect Plague, and Moonbeam are built — see{" "}
          <a href="#zones">Zones &amp; Persistent Effects</a> for what each of those looks like in play. The
          zone fields:
        </p>
        <ul>
          <li><strong>Lasts</strong> — a number of rounds, as long as you concentrate, or until dismissed.</li>
          <li>
            <strong>Triggers when a creature enters the area</strong> / <strong>starts its turn there</strong>{" "}
            / <strong>ends its turn there</strong> — each is its own toggle; re-fire the zone's save/damage/
            riders whenever the ones you enable happen. Cloudkill uses start-of-turn (hits you again every
            round you're standing in it); most others use on-enter.
          </li>
          <li>
            <strong>Also resolves immediately on cast</strong> — most zones (Insect Plague, Web) don't hit
            anyone the instant they're cast, only later when a trigger fires; turn this on if yours should.
          </li>
          <li>
            <strong>Drifts away from the caster</strong> + <strong>Feet per turn</strong> — Cloudkill-style
            automatic movement, no choice involved.
          </li>
          <li>
            <strong>Caster can reposition it</strong> + <strong>Feet per turn</strong> — Moonbeam-style: spends
            your bonus action each turn to steer the zone instead of it drifting on its own.
          </li>
          <li>
            <strong>Damages creatures that move through it</strong> + dice — Spike Growth-style automatic
            movement damage, no save, charged once per grid step into or within the zone.
          </li>
          <li>
            <strong>Becomes difficult or impassable terrain</strong> + a movement-cost multiplier (default
            double cost) — Web/Spike Growth-style.
          </li>
          <li><strong>Heavily obscures the area</strong> — flags the zone for the manual sight-measurement tool; it doesn't gate targeting/cover on its own.</li>
        </ul>

        <h3>Concentration, ritual, and spending a resource</h3>
        <p>These live under Advanced:</p>
        <ul>
          <li><strong>Concentration</strong> — casting another concentration spell ends this one.</li>
          <li><strong>Ritual</strong> — reference flag only; doesn't change simulation.</li>
          <li>
            <strong>Spends resource</strong> — the exact id of a resource pool on the caster's sheet (e.g.{" "}
            <code>slot-3</code>) that casting this spell consumes one of. If you leave this blank the spell
            costs nothing to cast. The id has to match a resource you've added on the actor's{" "}
            <strong>Stats</strong> tab, under Resources — type the same id there, give it a Current and a
            Default (max) value, and this spell will draw from it.
          </li>
        </ul>

        <h3>Upcasting with a higher slot</h3>
        <p>
          <strong>Extra damage per slot above base</strong> (Advanced, e.g. <code>1d6</code> for Fireball) adds
          that many extra dice for every spell-slot level above the spell's own level it gets cast with. This
          only works if <strong>Spends resource</strong> is set to a slot resource whose id is exactly{" "}
          <code>slot-&lt;level&gt;</code> — e.g. a 3rd-level spell should spend <code>slot-3</code>. The engine
          reads the number out of that id to know which higher slots are available, so a differently-named
          resource (or a flat non-slot resource like a limited-use charge) won't upcast even with this field
          filled in. Give the caster resources <code>slot-1</code> through however high they can cast, and the
          AI will choose a higher slot on its own when it has one to spare and the fight calls for it.
        </p>

        <h3>Two more things worth knowing</h3>
        <ul>
          <li>
            <strong>Restricting a rider to specific creature types</strong> — see{" "}
            <a href="#actors">Actor Sheets</a> for where a creature's own type is set; a rider's own
            restriction (above) is what makes an effect like Turn Undead only land on the types you check.
          </li>
          <li>
            <strong>Multi-target spells like Hold Person</strong> — authored as a single-target save with{" "}
            <strong>Extra creatures</strong> added via upcasting's <code>targets</code> growth (this one isn't
            exposed as its own form field yet — it comes from the same <code>Extra damage per slot above
            base</code> upcast data, authored on the SRD entry). Attach it from the Library rather than
            building it blank if you want that behavior out of the box.
          </li>
        </ul>

        <h3>Worked example: building Fireball from scratch</h3>
        <ol>
          <li>Actions tab → Add → Blank → Spell.</li>
          <li>Name: <em>Fireball</em>. Spell level: <em>3</em>. Timing: <em>Action</em>. Range: <em>150</em>.</li>
          <li>What it does: <em>Saving throw (area)</em>.</li>
          <li>Saving throw: <em>DEX</em>. On a successful save: <em>Half damage</em>. Deals damage: on, dice <em>8d6 fire</em>.</li>
          <li>Shape: <em>Circle</em>. Radius (ft): <em>20</em>. Centred on: <em>A point you choose</em>.</li>
          <li>Switch to Advanced. Concentration: off. Spends resource: <code>slot-3</code>. Extra damage per slot above base: <code>1d6</code>.</li>
          <li>Add to sheet. Make sure the caster has resources <code>slot-3</code> (and higher, if they can upcast it) on their Stats tab.</li>
        </ol>

        <h3>Worked example: a Cloudkill-style poison cloud</h3>
        <ol>
          <li>Actions tab → Add → Blank → Spell.</li>
          <li>Name: <em>Poison Cloud</em>. Spell level: <em>5</em>. Timing: <em>Action</em>. Range: <em>150</em>.</li>
          <li>What it does: <em>Saving throw (area)</em>. Saving throw: <em>CON</em>. On a successful save: <em>Half damage</em>. Deals damage: on, dice <em>5d8 poison</em>.</li>
          <li>Shape: <em>Circle</em>. Radius (ft): <em>20</em>. Centred on: <em>A point you choose</em>.</li>
          <li>Switch to Advanced. Toggle <strong>Leaves a persistent zone</strong> on.</li>
          <li>Lasts: <em>A number of rounds</em> → <em>10</em>. Trigger: enable <strong>starts its turn there</strong> (so it re-hits every round), leave the others off.</li>
          <li>Toggle <strong>Drifts away from the caster</strong> on, Feet per turn: <em>10</em>.</li>
          <li>Concentration: on. Spends resource: <code>slot-5</code>.</li>
          <li>Add to sheet — the zone will now settle onto the map, damage anyone standing in it at the start of their turn, and drift away from the caster each of the caster's turns until it expires or concentration breaks.</li>
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
    id: "accounts",
    label: "Accounts",
    content: (
      <>
        <p>
          BattleSim supports full multi-user accounts — sign up with an email and password (or another
          supported sign-in method) from the login screen. Once you're signed in, every campaign, encounter,
          and custom actor you create is scoped to your account and private to you.
        </p>
        <p>
          You can sign out from the icon in the top bar of the editor or from the Campaigns page. There's
          currently no sharing of campaigns between accounts — each user's content is their own.
        </p>
      </>
    )
  }
];

export function DocsPage() {
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
