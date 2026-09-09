"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  getExecutableActions,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type FeatureDefinition,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import { SRD_FEATURES, SRD_SPELLS, SRD_WEAPONS, searchSrd, type SrdEntryKind } from "@/data/srd";
import { useEncounterStore } from "@/store/encounter-store";
import { describeAction, spellAutomation, weaponAutomation } from "@/lib/sheet";
import { AutomationBadge } from "@/components/ui/AutomationBadge";
import type { Compendium } from "@/hooks/useCompendium";
import { BuilderForm } from "../builders/BuilderForm";
import {
  actionFieldSchema,
  actionFromEffectDraft,
  effectDraftFromAction,
  featureDraftFromDefinition,
  featureFieldSchema,
  featureFromDraft,
  PRESETS,
  spellDraftFromDefinition,
  spellFieldSchema,
  spellFromDraft,
  weaponDraftFromDefinition,
  weaponFieldSchema,
  weaponFromDraft,
  type BuilderDraft,
  type BuilderKind
} from "../builders/schemas";
import styles from "../builders/builders.module.css";

type EditTarget =
  | { kind: "weapon"; id: string }
  | { kind: "spell"; id: string }
  | { kind: "action"; id: string }
  | { kind: "feature"; id: string }
  | { kind: "new"; builderKind: BuilderKind };

const MODE_KEY = "actions-builder-mode";

function readMode(): "simple" | "advanced" {
  try {
    return localStorage.getItem(MODE_KEY) === "advanced" ? "advanced" : "simple";
  } catch {
    return "simple";
  }
}

function featureDetail(feature: FeatureDefinition): string {
  const granted = feature.grantedActions ?? [];
  const activate = granted.find((a) => a.kind === "activate-feature");
  if (activate) return `${activate.actionType} · activates ${feature.name}`;
  const utils = granted.filter((a) => a.kind === "utility");
  if (utils.length) return `bonus · ${utils.map((a) => (a.kind === "utility" ? a.mode : "")).join(" / ")}`;
  if (feature.effects?.length) return `passive · ${feature.effects.map((e) => e.kind).join(", ")}`;
  return feature.category;
}

export function ActionsTab({ definition, compendium }: { combatant: CombatantState; definition: CreatureDefinition; compendium?: Compendium }) {
  const addWeaponV2 = useEncounterStore((s) => s.addWeaponV2);
  const addSpellV2 = useEncounterStore((s) => s.addSpellV2);
  const addActionV2 = useEncounterStore((s) => s.addActionV2);
  const addFeatureV2 = useEncounterStore((s) => s.addFeatureV2);
  const updateWeapon = useEncounterStore((s) => s.updateWeapon);
  const updateSpell = useEncounterStore((s) => s.updateSpell);
  const updateAction = useEncounterStore((s) => s.updateAction);
  const updateFeature = useEncounterStore((s) => s.updateFeature);
  const removeDefinitionItem = useEncounterStore((s) => s.removeDefinitionItem);
  const addMultiattack = useEncounterStore((s) => s.addMultiattack);
  const attachSrdWeapon = useEncounterStore((s) => s.attachSrdWeapon);
  const attachSrdSpell = useEncounterStore((s) => s.attachSrdSpell);
  const attachSrdFeature = useEncounterStore((s) => s.attachSrdFeature);

  const [mode, setMode] = useState<"simple" | "advanced">(readMode);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [draft, setDraft] = useState<BuilderDraft>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<"library" | "preset" | "blank" | "import">("library");
  const [libKind, setLibKind] = useState<"all" | "weapon" | "spell" | "feature">("all");
  const [libQuery, setLibQuery] = useState("");
  const [maName, setMaName] = useState("Multiattack");
  const [maRows, setMaRows] = useState<Array<{ actionId: string; count: number; targetGroup: number }>>([]);

  function setModePersisted(next: "simple" | "advanced") {
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* private mode */ }
  }

  const weapons = definition.weapons ?? [];
  const spells = definition.spells ?? [];
  const features = [...(definition.features ?? []), ...(definition.traits ?? [])];
  const nativeActions = definition.actions ?? [];
  const bonusActions = definition.bonusActions ?? [];
  const reactions = definition.reactions ?? [];
  const multiattacks = nativeActions.filter((a) => a.kind === "multiattack");
  const plainActions = nativeActions.filter((a) => a.kind !== "multiattack");

  const attackChoices = useMemo(
    () => getExecutableActions(definition).filter((a) => a.kind === "attack" && a.actionType === "action"),
    [definition]
  );

  const libraryResults = useMemo(() => {
    const kind = libKind === "all" ? undefined : libKind;
    return libQuery.trim() ? searchSrd(libQuery, kind) : searchSrd("", kind).slice(0, 24);
  }, [libQuery, libKind]);

  function openEdit(target: EditTarget, initialDraft: BuilderDraft) {
    setDraft(initialDraft);
    setEdit(target);
    setAddOpen(false);
  }

  function editWeapon(weapon: WeaponDefinition) { openEdit({ kind: "weapon", id: weapon.id }, weaponDraftFromDefinition(weapon)); }
  function editSpell(spell: SpellDefinition) { openEdit({ kind: "spell", id: spell.id }, spellDraftFromDefinition(spell)); }
  function editActionRecord(action: ActionDefinition) { openEdit({ kind: "action", id: action.id }, effectDraftFromAction(action)); }
  function editFeature(feature: FeatureDefinition) { openEdit({ kind: "feature", id: feature.id }, featureDraftFromDefinition(feature)); }

  function startNew(builderKind: BuilderKind, initial: BuilderDraft) {
    openEdit({ kind: "new", builderKind }, initial);
  }

  function save() {
    if (!edit) return;
    if (edit.kind === "weapon") updateWeapon(definition.id, edit.id, weaponFromDraft(draft));
    else if (edit.kind === "spell") updateSpell(definition.id, edit.id, spellFromDraft(draft));
    else if (edit.kind === "action") updateAction(definition.id, edit.id, actionFromEffectDraft(draft));
    else if (edit.kind === "feature") updateFeature(definition.id, edit.id, featureFromDraft(draft));
    else if (edit.kind === "new") {
      if (edit.builderKind === "weapon") addWeaponV2(definition.id, weaponFromDraft(draft));
      else if (edit.builderKind === "spell") addSpellV2(definition.id, spellFromDraft(draft));
      else if (edit.builderKind === "feature") addFeatureV2(definition.id, featureFromDraft(draft));
      else addActionV2(definition.id, actionFromEffectDraft(draft));
    }
    setEdit(null);
  }

  function attachFromLibrary(kind: SrdEntryKind, id: string) {
    if (kind === "weapon") attachSrdWeapon(definition.id, id);
    else if (kind === "spell") attachSrdSpell(definition.id, id);
    else attachSrdFeature(definition.id, id);
    setAddOpen(false);
  }

  function builderFor(target: EditTarget) {
    const kind = target.kind === "new" ? target.builderKind : target.kind;
    const specs = kind === "weapon"
      ? weaponFieldSchema(draft)
      : kind === "spell"
        ? spellFieldSchema(draft)
        : kind === "feature"
          ? featureFieldSchema(draft)
          : actionFieldSchema(draft);
    return (
      <div className={styles.builder}>
        <BuilderForm specs={specs} draft={draft} mode={mode} onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))} />
        <button type="button" className={styles.builderSave} onClick={save}>
          {target.kind === "new" ? "Add to sheet" : "Save changes"}
        </button>
      </div>
    );
  }

  function row(
    key: string, name: string, detail: string, support: string | undefined,
    onEdit: () => void, onRemove: () => void, isEditing: boolean, editTarget?: EditTarget
  ) {
    return (
      <div key={key}>
        <div className={styles.row}>
          <div className={styles.rowMain}>
            <strong>{name}</strong>
            <span>{detail}</span>
            {support ? <AutomationBadge value={support} /> : null}
          </div>
          <button type="button" className={styles.rowBtn} onClick={onEdit} aria-label={`Edit ${name}`}><Pencil size={13} /></button>
          <button type="button" className={`${styles.rowBtn} ${styles.danger}`} onClick={onRemove} aria-label={`Remove ${name}`}><Trash2 size={13} /></button>
        </div>
        {isEditing && editTarget ? builderFor(editTarget) : null}
      </div>
    );
  }

  function addMaRow(actionId?: string) {
    const id = actionId ?? attackChoices[0]?.id;
    if (!id) return;
    setMaRows((rows) => [...rows, { actionId: id, count: 1, targetGroup: 0 }]);
  }

  function extraAttackPreset(times: number) {
    const primary = attackChoices[0]?.id;
    if (!primary) return;
    setMaName("Multiattack");
    setMaRows([{ actionId: primary, count: times, targetGroup: 0 }]);
  }

  return (
    <div>
      <div className={styles.header}>
        <button type="button" className={styles.addBtn} onClick={() => setAddOpen((v) => !v)}>
          <Plus size={14} /> Add
        </button>
        <div className={styles.modeToggle}>
          <button type="button" className={mode === "simple" ? styles.on : ""} onClick={() => setModePersisted("simple")}>Simple</button>
          <button type="button" className={mode === "advanced" ? styles.on : ""} onClick={() => setModePersisted("advanced")}>Advanced</button>
        </div>
      </div>

      {addOpen ? (
        <div className={styles.popover}>
          <div className={styles.popoverTabs}>
            <button type="button" className={addTab === "library" ? styles.on : ""} onClick={() => setAddTab("library")}>Library</button>
            <button type="button" className={addTab === "preset" ? styles.on : ""} onClick={() => setAddTab("preset")}>Preset</button>
            <button type="button" className={addTab === "blank" ? styles.on : ""} onClick={() => setAddTab("blank")}>Blank</button>
            <button type="button" className={addTab === "import" ? styles.on : ""} onClick={() => setAddTab("import")}>Import</button>
          </div>
          <div className={styles.popoverBody}>
            {addTab === "library" ? (
              <>
                <div className={styles.libFilter}>
                  {(["all", "weapon", "spell", "feature"] as const).map((k) => (
                    <button key={k} type="button" className={libKind === k ? styles.on : ""} onClick={() => setLibKind(k)}>
                      {k === "all" ? "All" : k === "weapon" ? "Weapons" : k === "spell" ? "Spells" : "Features"}
                    </button>
                  ))}
                </div>
                <input
                  type="search" placeholder="Search the library" aria-label="Search the library"
                  value={libQuery} onChange={(e) => setLibQuery(e.target.value)}
                />
                <div className={styles.libList}>
                  {libraryResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "copy";
                        e.dataTransfer.setData("application/x-battle-sim-srd", JSON.stringify({ kind: result.kind, id: result.id }));
                      }}
                      onClick={() => attachFromLibrary(result.kind, result.id)}
                    >
                      <strong>{result.name}</strong>
                      <span>
                        {result.kind === "weapon"
                          ? (result.entry as WeaponDefinition).attackType
                          : result.kind === "spell"
                            ? `level ${(result.entry as SpellDefinition).level}`
                            : (result.entry as FeatureDefinition).category}
                      </span>
                    </button>
                  ))}
                  {libraryResults.length === 0 ? <span style={{ padding: 8, fontSize: 11, color: "var(--ui-text-dim)" }}>No matches</span> : null}
                </div>
                <p style={{ margin: 0, fontSize: 10.5, color: "var(--ui-text-dim)" }}>
                  Click or drag onto the sheet. {SRD_WEAPONS.length} weapons, {SRD_SPELLS.length} spells, {SRD_FEATURES.length} features.
                </p>
              </>
            ) : null}

            {addTab === "preset" ? (
              <div className={styles.presetGrid}>
                {PRESETS.map((preset) => (
                  <button key={preset.label} type="button" onClick={() => startNew(preset.kind, { ...preset.draft })}>
                    {preset.label}
                  </button>
                ))}
              </div>
            ) : null}

            {addTab === "blank" ? (
              <div className={styles.presetGrid}>
                <button type="button" onClick={() => startNew("weapon", weaponDraftFromDefinition({ id: "", name: "New Weapon", attackType: "melee", ability: "str", range: 5, reach: 5, damage: [{ dice: "1d6", damageType: "bludgeoning" }] }))}>Weapon</button>
                <button type="button" onClick={() => startNew("spell", spellDraftFromDefinition({ id: "", name: "New Spell", level: 1, castingTime: "action", range: 60, automationSupport: "full" }))}>Spell</button>
                <button type="button" onClick={() => startNew("action", effectDraftFromAction({ kind: "attack", id: "", name: "New Ability", actionType: "action", attackType: "melee", ability: "str", range: 5, damage: [{ dice: "1d6", damageType: "bludgeoning" }], automationSupport: "full" }))}>Innate ability</button>
                <button type="button" onClick={() => startNew("feature", { name: "New Feature", category: "feature", featureShape: "passive", effects: [] })}>Feature / trait</button>
              </div>
            ) : null}

            {addTab === "import" ? (
              <>
                <div className={styles.libFilter}>
                  <input
                    type="search" placeholder="Search Open5e spells" aria-label="Search Open5e spells"
                    value={compendium?.query ?? ""}
                    onChange={(e) => compendium?.setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void compendium?.search("spells"); }}
                  />
                  <button type="button" onClick={() => void compendium?.search("spells")}>Search</button>
                </div>
                <div className={styles.libList}>
                  {(compendium?.results ?? []).filter((r) => r.resource === "spell").map((result) => (
                    <button key={result.key} type="button" onClick={() => void compendium?.importSpell(result.slug, definition.id)}>
                      <strong>{result.name}</strong>
                      <span>level {result.level ?? 0} · {result.documentTitle ?? "Open5e"} · attaches as reference</span>
                    </button>
                  ))}
                </div>
                {compendium?.status ? <p style={{ margin: 0, fontSize: 10.5, color: "var(--ui-text-dim)" }}>{compendium.status}</p> : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {edit?.kind === "new" ? builderFor(edit) : null}

      {multiattacks.length > 0 || attackChoices.length > 1 ? (
        <div className={styles.group}>
          <h4>Multiattack</h4>
          {multiattacks.map((action) => row(
            action.id, action.name, describeAction(action, definition), "full",
            () => { /* multiattack edits: remove + re-add */ }, () => removeDefinitionItem(definition.id, "action", action.id),
            false
          ))}
          <div className={styles.riderCard} style={{ marginTop: 6 }}>
            <input type="text" aria-label="Multiattack name" value={maName} onChange={(e) => setMaName(e.target.value)} />
            <div className={styles.chips}>
              <button type="button" onClick={() => extraAttackPreset(2)}>Extra Attack ×2</button>
              <button type="button" onClick={() => extraAttackPreset(3)}>Extra Attack ×3</button>
            </div>
            {maRows.map((maRow, index) => (
              <div key={index} className={styles.riderRow}>
                <select
                  aria-label={`Attack ${index + 1}`}
                  value={maRow.actionId}
                  onChange={(e) => setMaRows((rows) => rows.map((r, i) => (i === index ? { ...r, actionId: e.target.value } : r)))}
                >
                  {attackChoices.map((action) => <option key={action.id} value={action.id}>{action.name}</option>)}
                </select>
                <label className={styles.fieldInlineLabel}>×
                  <input type="number" min={1} value={maRow.count} style={{ width: 48 }}
                    onChange={(e) => setMaRows((rows) => rows.map((r, i) => (i === index ? { ...r, count: Math.max(1, Number(e.target.value) || 1) } : r)))} />
                </label>
                <label className={styles.fieldInlineLabel}>→ target
                  <input type="number" min={0} value={maRow.targetGroup} style={{ width: 48 }}
                    onChange={(e) => setMaRows((rows) => rows.map((r, i) => (i === index ? { ...r, targetGroup: Math.max(0, Number(e.target.value) || 0) } : r)))} />
                </label>
                <button type="button" className={styles.riderRemove} aria-label={`Remove attack ${index + 1}`} onClick={() => setMaRows((rows) => rows.filter((_, i) => i !== index))}>×</button>
              </div>
            ))}
            <button type="button" className={styles.riderAdd} onClick={() => addMaRow()}>+ Add attack</button>
            <button
              type="button" className={styles.riderAdd}
              onClick={() => {
                if (maRows.length) { addMultiattack(definition.id, { name: maName, attacks: maRows }); setMaRows([]); }
              }}
            >
              + Add multiattack
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.group}>
        <h4>Weapons</h4>
        {weapons.length === 0 ? <span style={{ fontSize: 11, color: "var(--ui-text-dim)" }}>None</span> : null}
        {weapons.map((weapon) => row(
          weapon.id, weapon.name,
          `${weapon.attackType} ${String(weapon.ability).toUpperCase()} · ${weapon.damage.map((c) => `${c.dice} ${c.damageType}`).join(", ")}${weapon.magical ? " · magical" : ""}${weapon.grip && weapon.grip !== "one-handed" ? ` · ${weapon.grip}` : ""}${weapon.powerAttack ? " · power attack" : ""}${weapon.charges ? ` · ${weapon.charges.max} charge${weapon.charges.max === 1 ? "" : "s"}` : ""}${weapon.onHit?.length ? ` · on-hit ${weapon.onHit.map((r) => r.kind === "condition" && typeof r.condition === "string" ? r.condition : r.kind).join(", ")}` : ""}`,
          weaponAutomation(weapon),
          () => editWeapon(weapon), () => removeDefinitionItem(definition.id, "weapon", weapon.id),
          edit?.kind === "weapon" && edit.id === weapon.id, { kind: "weapon", id: weapon.id }
        ))}
      </div>

      <div className={styles.group}>
        <h4>Spells</h4>
        {spells.length === 0 ? <span style={{ fontSize: 11, color: "var(--ui-text-dim)" }}>None</span> : null}
        {spells.map((spell) => row(
          spell.id, spell.name,
          `level ${spell.level} · ${spell.castingTime} · ${typeof spell.range === "number" ? `${spell.range} ft` : spell.range}${spell.concentration ? " · concentration" : ""}${spell.action ? ` · ${describeAction(spell.action, definition)}` : " · reference only"}`,
          spellAutomation(spell),
          () => editSpell(spell), () => removeDefinitionItem(definition.id, "spell", spell.id),
          edit?.kind === "spell" && edit.id === spell.id, { kind: "spell", id: spell.id }
        ))}
      </div>

      <div className={styles.group}>
        <h4>Features &amp; traits</h4>
        {features.length === 0 ? <span style={{ fontSize: 11, color: "var(--ui-text-dim)" }}>None</span> : null}
        {features.map((feature) => row(
          feature.id, feature.name, featureDetail(feature), feature.automationSupport,
          () => editFeature(feature),
          () => removeDefinitionItem(definition.id, feature.category === "trait" ? "trait" : "feature", feature.id),
          edit?.kind === "feature" && edit.id === feature.id, { kind: "feature", id: feature.id }
        ))}
      </div>

      {[["Actions", plainActions, "action"], ["Bonus actions", bonusActions, "bonusAction"], ["Reactions", reactions, "reaction"]].map(([title, list, itemType]) => {
        const actions = list as ActionDefinition[];
        if (actions.length === 0) return null;
        return (
          <div key={title as string} className={styles.group}>
            <h4>{title as string}</h4>
            {actions.map((action) => row(
              action.id, action.name, describeAction(action, definition), "automationSupport" in action ? action.automationSupport : "full",
              () => editActionRecord(action), () => removeDefinitionItem(definition.id, itemType as "action", action.id),
              edit?.kind === "action" && edit.id === action.id, { kind: "action", id: action.id }
            ))}
          </div>
        );
      })}

      <div className={styles.group}>
        <h4>Standard actions</h4>
        <p style={{ margin: 0, fontSize: 11, color: "var(--ui-text-dim)" }}>
          Every creature can Dash · Disengage · Dodge · Hide · Help — no setup needed.
        </p>
      </div>
    </div>
  );
}
