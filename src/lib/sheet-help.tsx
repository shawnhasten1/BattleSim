/**
 * Shared `InfoTooltip` content for concepts that show up in more than one
 * place on the sheet (automation, combatant state). Tooltip content that's
 * local to a single dropdown (tactics profiles, resource stances, actor tags)
 * is built next to that dropdown instead — see token/TacticsSection.tsx.
 */

/** The Abilities list's dots, which the sheet's title bar counts. */
/** What every creature can do without anything on its sheet: the foot of the Abilities list, on Standard and the Codex. */
export const STANDARD_ACTIONS = "Every creature can Dash · Disengage · Dodge · Hide · Help — no setup needed.";

export const AUTOMATION_HELP = (
  <dl>
    <div>
      <dt>● Simulated</dt>
      <dd>The AI uses it as written: attack rolls, damage, saves and conditions resolve on their own.</dd>
    </div>
    <div>
      <dt>◐ Partly simulated</dt>
      <dd>The simulator runs only part of it, or the AI never uses it on its own (Reckless Attack, a reaction set to manual). Hover its dot to see which.</dd>
    </div>
    <div>
      <dt>○ Reference only</dt>
      <dd>On the sheet for you to play by hand: the AI and batch runs never use it. Flavor with no combat effect has a hollow dot too, and isn&apos;t counted.</dd>
    </div>
  </dl>
);

export const COMBATANT_STATE_HELP = (
  <dl>
    <div>
      <dt>Active</dt>
      <dd>Can act and be targeted normally.</dd>
    </div>
    <div>
      <dt>Downed</dt>
      <dd>Hit 0 HP and is making death saves — party members only, when that rule is on. Still a valid finishing target.</dd>
    </div>
    <div>
      <dt>Defeated</dt>
      <dd>Hit 0 HP without death saves — out of the fight for good (the usual outcome for enemies).</dd>
    </div>
    <div>
      <dt>Dead</dt>
      <dd>Permanently out: 3 failed death saves, or the DM's call. Can't be healed or targeted.</dd>
    </div>
    <div>
      <dt>Fled</dt>
      <dd>Left the fight under its own power. A DM-set state only — the engine never sets this automatically. Can't be healed or targeted.</dd>
    </div>
  </dl>
);
