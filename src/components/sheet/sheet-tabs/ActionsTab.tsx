"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  getExecutableActions,
  type ActionDefinition,
  type MultiattackActionDefinition,
  type SummonActionDefinition,
  type TransformActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type DeathEffectDefinition,
  type FeatureDefinition,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import { SRD_FEATURES, SRD_SPELLS, SRD_WEAPONS, searchSrd, type SrdEntryKind } from "@/data/srd";
import { SRD_CREDITS_PATH } from "@/data/srd/attribution";
import { useEncounterStore } from "@/store/encounter-store";
import { describeAction, describeFeature, spellAutomation, weaponAutomation } from "@/lib/sheet";
import { multiattackLosses, type DefinitionItemType } from "@/lib/definition-edits";
import { AutomationBadge } from "@/components/ui/AutomationBadge";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AUTOMATION_HELP } from "@/lib/sheet-help";
import type { Compendium } from "@/hooks/useCompendium";
import { BuilderForm } from "../builders/BuilderForm";
import { SummonEditor, TransformEditor } from "../builders/SpawnEditors";
import { mergeDraftEdit } from "../builders/save-delta";
import {
  actionFieldSchema,
  actionFromEffectDraft,
  applyDraftChange,
  deathEffectDraftFromDefinition,
  deathEffectFieldSchema,
  deathEffectFromDraft,
  effectDraftFromAction,
  featureBuilderContext,
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
  | { kind: "deathEffect"; id: string }
  | { kind: "action"; id: string }
  | { kind: "feature"; id: string }
  | { kind: "lairAction"; id: string }
  | { kind: "new"; builderKind: BuilderKind | "lairAction" };

interface PendingRemoval {
  itemType: DefinitionItemType;
  itemId: string;
  name: string;
}

/** The starting point for "+ Lair action": an eruption somewhere it can see. */
const NEW_LAIR_ACTION: ActionDefinition = {
  kind: "area-save", id: "", name: "Lair action", actionType: "action", saveAbility: "dex", dc: 15, range: 120,
  area: { type: "circle", size: 10 }, targeting: { origin: "point", range: 120 }, damage: [{ dice: "3d6", damageType: "fire" }],
  halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile", automationSupport: "full"
};

const MODE_KEY = "actions-builder-mode";

function readMode(): "simple" | "advanced" {
  try {
    return localStorage.getItem(MODE_KEY) === "advanced" ? "advanced" : "simple";
  } catch {
    return "simple";
  }
}

function featureDetail(feature: FeatureDefinition): string {
  return describeFeature(feature);
}

export function ActionsTab({ definition, compendium }: { combatant: CombatantState; definition: CreatureDefinition; compendium?: Compendium }) {
  const addWeaponV2 = useEncounterStore((s) => s.addWeaponV2);
  const addSpellV2 = useEncounterStore((s) => s.addSpellV2);
  const addActionV2 = useEncounterStore((s) => s.addActionV2);
  const addFeatureV2 = useEncounterStore((s) => s.addFeatureV2);
  const addDeathEffectV2 = useEncounterStore((s) => s.addDeathEffectV2);
  const updateWeapon = useEncounterStore((s) => s.updateWeapon);
  const updateSpell = useEncounterStore((s) => s.updateSpell);
  const updateAction = useEncounterStore((s) => s.updateAction);
  const updateFeature = useEncounterStore((s) => s.updateFeature);
  const addSpawnAction = useEncounterStore((s) => s.addSpawnAction);
  const definitionStatus = useEncounterStore((s) => s.definitionStatus);
  const sceneDefinitions = useEncounterStore((s) => s.encounter.definitions);
  const [spawnEditor, setSpawnEditor] = useState<"summon" | "transform" | null>(null);
  // The existing summon / shapechange being edited, or none when adding a new one.
  const [spawnEditing, setSpawnEditing] = useState<SummonActionDefinition | TransformActionDefinition | null>(null);
  const updateDeathEffect = useEncounterStore((s) => s.updateDeathEffect);
  const addLairAction = useEncounterStore((s) => s.addLairAction);
  const updateLairAction = useEncounterStore((s) => s.updateLairAction);
  const removeDefinitionItem = useEncounterStore((s) => s.removeDefinitionItem);
  const addMultiattack = useEncounterStore((s) => s.addMultiattack);
  const updateMultiattack = useEncounterStore((s) => s.updateMultiattack);
  const attachSrdWeapon = useEncounterStore((s) => s.attachSrdWeapon);
  const attachSrdSpell = useEncounterStore((s) => s.attachSrdSpell);
  const attachSrdFeature = useEncounterStore((s) => s.attachSrdFeature);

  const [mode, setMode] = useState<"simple" | "advanced">(readMode);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [draft, setDraft] = useState<BuilderDraft>({});
  // The draft as the builder opened, so a save writes only what changed since (see save-delta.ts).
  const [initialDraft, setInitialDraft] = useState<BuilderDraft>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<"library" | "preset" | "blank" | "import">("library");
  const [libKind, setLibKind] = useState<"all" | "weapon" | "spell" | "feature">("all");
  const [libQuery, setLibQuery] = useState("");
  const [maName, setMaName] = useState("Multiattack");
  const [maRows, setMaRows] = useState<Array<{ actionId: string; count: number; targetGroup: number }>>([]);
  // A delete waiting on "Delete Claws?" because a multiattack would change with it.
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  // The multiattack the form is editing, or null when it's building a new one.
  const [maEditingId, setMaEditingId] = useState<string | null>(null);

  function setModePersisted(next: "simple" | "advanced") {
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* private mode */ }
  }

  const weapons = definition.weapons ?? [];
  const spells = definition.spells ?? [];
  const deathEffects = definition.deathEffects ?? [];
  const features = [...(definition.features ?? []), ...(definition.traits ?? [])];
  const nativeActions = definition.actions ?? [];
  const bonusActions = definition.bonusActions ?? [];
  const reactions = definition.reactions ?? [];
  const lairActions = definition.lairActions ?? [];
  const multiattacks = nativeActions.filter((a): a is MultiattackActionDefinition => a.kind === "multiattack");
  const plainActions = nativeActions.filter((a) => a.kind !== "multiattack");
  const optionalGrants = features
    .filter((feature) => feature.optional)
    .flatMap((feature) => (feature.grantedActions ?? []).map((action) => ({ feature, action })));

  const executableActions = useMemo(() => getExecutableActions(definition), [definition]);
  const attackChoices = useMemo(
    () => executableActions.filter((a) => a.kind === "attack" && a.actionType === "action"),
    [executableActions]
  );
  // The feature builder picks a Pounce / Rampage follow-up from these.
  const featureContext = useMemo(() => featureBuilderContext(definition), [definition]);

  const libraryResults = useMemo(() => {
    const kind = libKind === "all" ? undefined : libKind;
    return searchSrd(libQuery, kind);
  }, [libQuery, libKind]);

  function openEdit(target: EditTarget, opened: BuilderDraft) {
    setDraft(opened);
    setInitialDraft(opened);
    setEdit(target);
    setAddOpen(false);
  }

  function editWeapon(weapon: WeaponDefinition) { openEdit({ kind: "weapon", id: weapon.id }, weaponDraftFromDefinition(weapon)); }
  function editSpell(spell: SpellDefinition) { openEdit({ kind: "spell", id: spell.id }, spellDraftFromDefinition(spell)); }
  function editDeathEffect(deathEffect: DeathEffectDefinition) { openEdit({ kind: "deathEffect", id: deathEffect.id }, deathEffectDraftFromDefinition(deathEffect)); }
  function editActionRecord(action: ActionDefinition) {
    // Summons and shapechanges have their own editors; the generic ability builder would turn them into an attack.
    if (action.kind === "summon" || action.kind === "transform") {
      setEdit(null);
      setAddOpen(false);
      setSpawnEditing(action);
      setSpawnEditor(action.kind);
      return;
    }
    openEdit({ kind: "action", id: action.id }, effectDraftFromAction(action));
  }
  function editFeature(feature: FeatureDefinition) { openEdit({ kind: "feature", id: feature.id }, featureDraftFromDefinition(feature, featureContext)); }

  /** The summon / shapechange editor: under the Add button for a new one, or under the row of the one being edited. */
  function spawnEditorNode() {
    return (
      <>
        {spawnEditor === "summon" ? (
          <SummonEditor
            ownerId={definition.id} sceneActors={sceneDefinitions} onCancel={() => { setSpawnEditor(null); setSpawnEditing(null); }}
            initial={spawnEditing?.kind === "summon" ? spawnEditing : undefined}
            onSave={async (action) => { if (await addSpawnAction(definition.id, action, spawnEditing?.id)) { setSpawnEditor(null); setSpawnEditing(null); } }}
          />
        ) : null}
        {spawnEditor === "transform" ? (
          <TransformEditor
            ownerId={definition.id} sceneActors={sceneDefinitions} onCancel={() => { setSpawnEditor(null); setSpawnEditing(null); }}
            initial={spawnEditing?.kind === "transform" ? spawnEditing : undefined}
            onSave={async (action) => { if (await addSpawnAction(definition.id, action, spawnEditing?.id)) { setSpawnEditor(null); setSpawnEditing(null); } }}
          />
        ) : null}
        {spawnEditor && definitionStatus ? <p role="alert" className={styles.maHint}>{definitionStatus}</p> : null}
      </>
    );
  }

  function startNew(builderKind: BuilderKind | "lairAction", initial: BuilderDraft) {
    openEdit({ kind: "new", builderKind }, initial);
  }

  /**
   * Write an edit back. Only what the DM changed is written, so what the builder can't show survives the save; an
   * edit that changes nothing writes nothing (and adds no undo step).
   */
  function commitEdit<T>(stored: T | undefined, convert: (edited: BuilderDraft) => unknown, write: (record: T) => void) {
    if (!stored) return;
    const result = mergeDraftEdit(stored, initialDraft, draft, convert);
    if (result.changed) write(result.record);
  }

  function save() {
    if (!edit) return;
    if (edit.kind === "weapon") {
      commitEdit(weapons.find((weapon) => weapon.id === edit.id), weaponFromDraft, (record) => updateWeapon(definition.id, edit.id, record));
    } else if (edit.kind === "spell") {
      commitEdit(spells.find((spell) => spell.id === edit.id), spellFromDraft, (record) => updateSpell(definition.id, edit.id, record));
    } else if (edit.kind === "deathEffect") {
      commitEdit(deathEffects.find((effect) => effect.id === edit.id), deathEffectFromDraft, (record) => updateDeathEffect(definition.id, edit.id, record));
    } else if (edit.kind === "action") {
      commitEdit(
        [...nativeActions, ...bonusActions, ...reactions].find((action) => action.id === edit.id),
        (edited) => actionFromEffectDraft(edited),
        (record) => updateAction(definition.id, edit.id, record)
      );
    } else if (edit.kind === "feature") {
      commitEdit(features.find((feature) => feature.id === edit.id), (edited) => featureFromDraft(edited, featureContext), (record) => updateFeature(definition.id, edit.id, record));
    } else if (edit.kind === "lairAction") {
      commitEdit(lairActions.find((action) => action.id === edit.id), (edited) => actionFromEffectDraft(edited), (record) => updateLairAction(definition.id, edit.id, record));
    } else if (edit.kind === "new") {
      if (edit.builderKind === "weapon") addWeaponV2(definition.id, weaponFromDraft(draft));
      else if (edit.builderKind === "spell") addSpellV2(definition.id, spellFromDraft(draft));
      else if (edit.builderKind === "deathEffect") addDeathEffectV2(definition.id, deathEffectFromDraft(draft));
      else if (edit.builderKind === "feature") addFeatureV2(definition.id, featureFromDraft(draft, featureContext));
      else if (edit.builderKind === "lairAction") addLairAction(definition.id, actionFromEffectDraft(draft));
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
        : kind === "deathEffect"
          ? deathEffectFieldSchema(draft)
          : kind === "feature"
            ? featureFieldSchema(draft, featureContext)
            : actionFieldSchema(draft);
    return (
      <div className={styles.builder}>
        <BuilderForm specs={specs} draft={draft} mode={mode} onChange={(key, value) => setDraft((d) => applyDraftChange(d, key, value))} />
        <div className={styles.builderActions}>
          <button type="button" className={styles.builderCancel} onClick={() => setEdit(null)}>
            Cancel
          </button>
          <button type="button" className={styles.builderSave} onClick={save}>
            {target.kind === "new" ? "Add to sheet" : "Save changes"}
          </button>
        </div>
      </div>
    );
  }

  /** Delete a record, but ask first when a multiattack would lose a step (or be deleted) along with it. */
  function requestRemove(itemType: DefinitionItemType, itemId: string, name: string) {
    if (multiattackLosses(definition, itemType, itemId).length > 0) {
      setPendingRemoval({ itemType, itemId, name });
      return;
    }
    if (itemType === "action" && itemId === maEditingId) resetMultiattackForm();
    removeDefinitionItem(definition.id, itemType, itemId);
  }

  /** "Delete Claws?", under a row whose deletion would change a multiattack. */
  function removalPrompt({ itemType, itemId, name }: PendingRemoval) {
    const losses = multiattackLosses(definition, itemType, itemId);
    const deleted = losses.filter((loss) => !loss.after);
    const confirmLabel = deleted.length === 0 ? `Delete ${name}`
      : deleted.length === 1 ? `Delete ${name} and ${deleted[0]!.multiattack.name}`
        : `Delete ${name} and ${deleted.length} multiattacks`;
    return (
      <div className={styles.confirmRemove} role="alertdialog" aria-label={`Delete ${name}?`}>
        <strong>Delete {name}?</strong>
        {losses.map((loss) => (
          <p key={loss.multiattack.id}>
            {loss.after
              ? `${loss.multiattack.name} uses ${name}. Without it, ${loss.multiattack.name} will be: ${describeAction(loss.after, loss.definitionAfter)}.`
              : `${loss.multiattack.name} uses only ${name}, so it will be deleted too.`}
          </p>
        ))}
        <div className={styles.builderActions}>
          <button type="button" className={styles.builderCancel} onClick={() => setPendingRemoval(null)}>
            Cancel
          </button>
          <button
            type="button" className={styles.confirmDelete}
            onClick={() => {
              setPendingRemoval(null);
              if (maEditingId && losses.some((loss) => loss.multiattack.id === maEditingId)) resetMultiattackForm();
              removeDefinitionItem(definition.id, itemType, itemId);
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    );
  }

  function row(
    key: string, name: string, detail: string, support: string | undefined,
    onEdit: () => void, itemType: DefinitionItemType, isEditing: boolean, editTarget?: EditTarget
  ) {
    const confirming = pendingRemoval?.itemType === itemType && pendingRemoval.itemId === key;
    return (
      <div key={key}>
        <div className={styles.row}>
          <div className={styles.rowMain}>
            <strong>{name}</strong>
            <span>{detail}</span>
            {support ? <AutomationBadge value={support} /> : null}
          </div>
          <button type="button" className={styles.rowBtn} onClick={onEdit} aria-label={`Edit ${name}`}><Pencil size={13} /></button>
          <button type="button" className={`${styles.rowBtn} ${styles.danger}`} onClick={() => requestRemove(itemType, key, name)} aria-label={`Remove ${name}`}><Trash2 size={13} /></button>
        </div>
        {confirming ? removalPrompt(pendingRemoval) : null}
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

  function editMultiattack(action: MultiattackActionDefinition) {
    setEdit(null);
    setMaName(action.name);
    // A step's saved target group is kept as it is, though the form no longer offers it (it has no effect in play).
    setMaRows(action.attacks.map((step) => ({ actionId: step.actionId, count: step.count, targetGroup: step.targetGroup ?? 0 })));
    setMaEditingId(action.id);
  }

  function resetMultiattackForm() {
    setMaName("Multiattack");
    setMaRows([]);
    setMaEditingId(null);
  }

  function saveMultiattack() {
    if (maRows.length === 0) return;
    if (maEditingId) updateMultiattack(definition.id, maEditingId, { name: maName, attacks: maRows });
    else addMultiattack(definition.id, { name: maName, attacks: maRows });
    resetMultiattackForm();
  }

  const maTotal = maRows.reduce((sum, r) => sum + r.count, 0);
  const attackName = (id: string) => executableActions.find((a) => a.id === id)?.name ?? id;
  // A step can name something other than an attack (a dragon's Frightful Presence); keep it choosable while editing.
  const stepChoices = [
    ...attackChoices,
    ...executableActions.filter((action) => !attackChoices.includes(action) && maRows.some((r) => r.actionId === action.id))
  ];

  return (
    <div>
      <div className={styles.header}>
        <button type="button" className={styles.addBtn} onClick={() => setAddOpen((v) => !v)}>
          <Plus size={14} /> Add
        </button>
        <div className={styles.headerRight}>
          <InfoTooltip label="About automation levels" content={AUTOMATION_HELP} />
          <div className={styles.modeToggle}>
            <button type="button" className={mode === "simple" ? styles.on : ""} onClick={() => setModePersisted("simple")}>Simple</button>
            <button type="button" className={mode === "advanced" ? styles.on : ""} onClick={() => setModePersisted("advanced")}>Advanced</button>
          </div>
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
                  Click or drag onto the sheet. {SRD_WEAPONS.length} weapons, {SRD_SPELLS.length} spells, {SRD_FEATURES.length} features.{" "}
                  {/* Opens in a new tab so the sheet being edited isn't left. */}
                  <a href={SRD_CREDITS_PATH} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}>
                    SRD 5.1 credits · CC-BY-4.0
                  </a>
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
                <button type="button" onClick={() => startNew("spell", spellDraftFromDefinition({ id: "", name: "New Spell", level: 1, castingTime: "action", range: 60, resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full", action: { kind: "attack", id: "", name: "New Spell", actionType: "action", attackType: "spell", ability: "int", range: 60, damage: [{ dice: "1d10", damageType: "fire" }], automationSupport: "full" } }))}>Spell</button>
                <button type="button" onClick={() => startNew("deathEffect", deathEffectDraftFromDefinition({ id: "", name: "New Death Effect", action: { kind: "area-save", id: "", name: "New Death Effect", actionType: "action", saveAbility: "con", dc: 10, range: 0, area: { type: "circle", size: 10 }, targeting: { origin: "self", range: 0 }, damage: [{ dice: "2d6", damageType: "poison" }], halfDamageOnSuccess: false, onSuccess: "negates", affects: "all", automationSupport: "full" }, automationSupport: "full" }))}>Death effect</button>
                <button type="button" onClick={() => startNew("action", effectDraftFromAction({ kind: "attack", id: "", name: "New Ability", actionType: "action", attackType: "melee", ability: "str", range: 5, damage: [{ dice: "1d6", damageType: "bludgeoning" }], automationSupport: "full" }))}>Innate ability</button>
                <button type="button" onClick={() => startNew("feature", { name: "New Feature", category: "feature", featureShape: "passive", effects: [] })}>Feature / trait</button>
                <button type="button" onClick={() => { setEdit(null); setAddOpen(false); setSpawnEditing(null); setSpawnEditor("summon"); }}>Summon</button>
                <button type="button" onClick={() => { setEdit(null); setAddOpen(false); setSpawnEditing(null); setSpawnEditor("transform"); }}>Shapechange</button>
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
        {spawnEditor && !spawnEditing ? spawnEditorNode() : null}


      {edit?.kind === "new" && edit.builderKind !== "lairAction" ? builderFor(edit) : null}

      <div className={styles.group}>
        <h4>Weapons</h4>
        {weapons.length === 0 ? <span style={{ fontSize: 11, color: "var(--ui-text-dim)" }}>None</span> : null}
        {weapons.map((weapon) => row(
          weapon.id, weapon.name,
          `${weapon.attackType} ${String(weapon.ability).toUpperCase()} · ${weapon.damage.map((c) => `${c.dice} ${c.damageType}`).join(", ")}${weapon.magical ? " · magical" : ""}${weapon.grip && weapon.grip !== "one-handed" ? ` · ${weapon.grip}` : ""}${weapon.powerAttack ? " · power attack" : ""}${weapon.charges ? ` · ${weapon.charges.max} charge${weapon.charges.max === 1 ? "" : "s"}` : ""}${weapon.onHit?.length ? ` · on-hit ${weapon.onHit.map((r) => r.kind === "condition" && typeof r.condition === "string" ? r.condition : r.kind).join(", ")}` : ""}`,
          weaponAutomation(weapon),
          () => editWeapon(weapon), "weapon",
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
          () => editSpell(spell), "spell",
          edit?.kind === "spell" && edit.id === spell.id, { kind: "spell", id: spell.id }
        ))}
      </div>

      <div className={styles.group}>
        <h4>Death effects</h4>
        <p style={{ margin: 0, fontSize: 11, color: "var(--ui-text-dim)" }}>
          Fires once, automatically, the moment this creature drops to 0 HP &mdash; no action spent, no target chosen.
        </p>
        {deathEffects.length === 0 ? <span style={{ fontSize: 11, color: "var(--ui-text-dim)" }}>None</span> : null}
        {deathEffects.map((deathEffect) => row(
          deathEffect.id, deathEffect.name,
          describeAction(deathEffect.action, definition),
          deathEffect.automationSupport,
          () => editDeathEffect(deathEffect), "deathEffect",
          edit?.kind === "deathEffect" && edit.id === deathEffect.id, { kind: "deathEffect", id: deathEffect.id }
        ))}
      </div>

      <div className={styles.group}>
        <h4>Features &amp; traits</h4>
        {features.length === 0 && multiattacks.length === 0 ? <span style={{ fontSize: 11, color: "var(--ui-text-dim)" }}>None</span> : null}
        {features.map((feature) => (
          <div key={feature.id}>
            {row(
              feature.id, feature.name, featureDetail(feature), feature.informational ? "informational" : feature.automationSupport,
              () => editFeature(feature),
              feature.category === "trait" ? "trait" : "feature",
              edit?.kind === "feature" && edit.id === feature.id, { kind: "feature", id: feature.id }
            )}
            {feature.optional && (feature.grantedActions?.length ?? 0) > 0 ? (
              <label className={styles.fieldInlineLabel}>
                <input
                  type="checkbox" checked={feature.enabled === true}
                  onChange={(e) => updateFeature(definition.id, feature.id, { enabled: e.target.checked ? true : undefined })}
                />
                Use this optional rule
              </label>
            ) : null}
          </div>
        ))}

        {multiattacks.map((action) => row(
          action.id, action.name, describeAction(action, definition), "full",
          () => editMultiattack(action),
          "action",
          false
        ))}

        {multiattacks.length > 0 || attackChoices.length >= 1 ? (
          <div className={styles.maBuilder}>
            <p className={styles.maSubHead}>{maEditingId ? "Edit multiattack" : "Multiattack"}</p>
            <p className={styles.maHint}>
              Make several attacks with one Attack action &mdash; a fighter&apos;s Extra Attack, or a
              monster&apos;s &ldquo;two claws and a bite&rdquo;. Choose each attack and how many times it&apos;s made.
            </p>

            <label className={styles.fieldInlineLabel}>
              Name of this multiattack
              <input type="text" value={maName} onChange={(e) => setMaName(e.target.value)} />
            </label>

            <div className={styles.maQuick}>
              <span>Quick start</span>
              <button type="button" onClick={() => extraAttackPreset(2)}>Extra Attack (2 swings)</button>
              <button type="button" onClick={() => extraAttackPreset(3)}>Extra Attack (3 swings)</button>
              <button type="button" onClick={() => extraAttackPreset(4)}>4 swings</button>
            </div>

            {maRows.length > 0 ? (
              <div className={styles.maSteps}>
                <div className={styles.maStepHead}>
                  <span>Attack</span>
                  <span>How many</span>
                  <span />
                </div>
                {maRows.map((maRow, index) => (
                  <div key={index} className={styles.maStep}>
                    <select
                      aria-label={`Attack ${index + 1} weapon`}
                      value={maRow.actionId}
                      onChange={(e) => setMaRows((rows) => rows.map((r, i) => (i === index ? { ...r, actionId: e.target.value } : r)))}
                    >
                      {stepChoices.map((action) => <option key={action.id} value={action.id}>{action.name}</option>)}
                      {executableActions.some((action) => action.id === maRow.actionId)
                        ? null
                        : <option value={maRow.actionId}>{maRow.actionId} (missing)</option>}
                    </select>
                    <div className={styles.maStepCount}>
                      <input
                        type="number" min={1} aria-label={`Attack ${index + 1} count`} value={maRow.count}
                        onChange={(e) => setMaRows((rows) => rows.map((r, i) => (i === index ? { ...r, count: Math.max(1, Number(e.target.value) || 1) } : r)))}
                      />
                      <span>{maRow.count === 1 ? "time" : "times"}</span>
                    </div>
                    <button type="button" className={styles.riderRemove} aria-label={`Remove attack ${index + 1}`} onClick={() => setMaRows((rows) => rows.filter((_, i) => i !== index))}>×</button>
                  </div>
                ))}
              </div>
            ) : null}

            <button type="button" className={styles.riderAdd} onClick={() => addMaRow()}>+ Add another attack</button>

            {maRows.length > 0 ? (
              <p className={styles.maPreview}>
                This multiattack:{" "}
                {maRows.map((r, i) => (
                  <span key={i}>
                    {i > 0 ? " + " : ""}
                    <strong>{r.count}×</strong> {attackName(r.actionId)}
                  </span>
                ))}
                {" "}({maTotal} attack{maTotal === 1 ? "" : "s"} total)
              </p>
            ) : null}

            <div className={styles.builderActions}>
              {maEditingId ? (
                <button type="button" className={styles.builderCancel} onClick={resetMultiattackForm}>
                  Cancel
                </button>
              ) : null}
              <button type="button" className={styles.builderSave} disabled={maRows.length === 0} onClick={saveMultiattack}>
                {maEditingId ? "Save multiattack" : "Create multiattack"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {[["Actions", plainActions, "action"], ["Bonus actions", bonusActions, "bonusAction"], ["Reactions", reactions, "reaction"]].map(([title, list, itemType]) => {
        const actions = list as ActionDefinition[];
        // An optional rule's action (a demon's Summon Demon) sits here too, switched off or on, so it is where the DM looks for it.
        const granted = optionalGrants.filter(({ action }) => (itemType === "bonusAction" ? action.actionType === "bonus" : itemType === "reaction" ? action.actionType === "reaction" : action.actionType === "action"));
        if (actions.length === 0 && granted.length === 0) return null;
        return (
          <div key={title as string} className={styles.group}>
            <h4>{title as string}</h4>
            {actions.map((action) => (
              <div key={action.id}>
                {row(
                  action.id, action.name, describeAction(action, definition), "automationSupport" in action ? action.automationSupport : "full",
                  () => editActionRecord(action), itemType as DefinitionItemType,
                  edit?.kind === "action" && edit.id === action.id, { kind: "action", id: action.id }
                )}
                {spawnEditor && spawnEditing?.id === action.id ? spawnEditorNode() : null}
              </div>
            ))}
            {granted.map(({ feature, action }) => (
              <div key={`${feature.id}:${action.id}`} className={styles.row} style={{ opacity: feature.enabled ? 1 : 0.6 }}>
                <div className={styles.rowMain}>
                  <strong>{action.name}</strong>
                  <span>
                    {describeAction(action, definition)} · optional rule ({feature.name}) — {feature.enabled ? "ON, the AI can use it" : "OFF, the AI ignores it"}
                  </span>
                  <AutomationBadge value={"automationSupport" in action ? action.automationSupport : "full"} />
                </div>
                <button
                  type="button" className={styles.rowBtn} style={{ width: "auto", padding: "0 8px" }}
                  aria-label={`${feature.enabled ? "Turn off" : "Turn on"} ${action.name}`}
                  onClick={() => updateFeature(definition.id, feature.id, { enabled: feature.enabled ? undefined : true })}
                >
                  {feature.enabled ? "Turn off" : "Turn on"}
                </button>
              </div>
            ))}
          </div>
        );
      })}

      <div className={styles.group}>
        <h4>
          Lair actions{" "}
          <InfoTooltip
            label="About lair actions"
            content="While a token of this creature is in its lair (right-click the token, or the Token tab), it takes one of these on initiative 20 each round — after anyone who rolled 20 or higher — and never the same one two rounds running. They cost none of its own actions. The SRD statblocks don't include lair actions, so write your own."
          />
        </h4>
        {lairActions.length === 0 ? (
          <span style={{ fontSize: 11, color: "var(--ui-text-dim)" }}>None — add one to make this creature's home fight back.</span>
        ) : null}
        {lairActions.map((action) => row(
          action.id, action.name, describeAction(action, definition), "automationSupport" in action ? action.automationSupport : "full",
          () => openEdit({ kind: "lairAction", id: action.id }, effectDraftFromAction(action)),
          "lairAction",
          edit?.kind === "lairAction" && edit.id === action.id, { kind: "lairAction", id: action.id }
        ))}
        {edit?.kind === "new" && edit.builderKind === "lairAction" ? builderFor(edit) : null}
        <div className={styles.riderRow}>
          <button type="button" className={styles.riderAdd} onClick={() => startNew("lairAction", effectDraftFromAction(NEW_LAIR_ACTION))}>+ Lair action</button>
        </div>
      </div>

      <div className={styles.group}>
        <h4>Standard actions</h4>
        <p style={{ margin: 0, fontSize: 11, color: "var(--ui-text-dim)" }}>
          Every creature can Dash · Disengage · Dodge · Hide · Help — no setup needed.
        </p>
      </div>
    </div>
  );
}
