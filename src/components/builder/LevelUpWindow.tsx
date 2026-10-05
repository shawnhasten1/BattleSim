"use client";

import { useMemo, useState } from "react";
import {
  buildCharacter,
  buildLabel,
  orderedChanges,
  readBuild,
  rebuildActor,
  withChoice,
  withLevelUp,
  withSuggestions,
  type CharacterBuild
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import { useEncounterStore } from "@/store/encounter-store";
import { ChoiceControl } from "./ChoiceControl";
import { BESIDE_SHEET, ChangeList } from "./CharacterBuilder";
import styles from "./builder.module.css";

const sources = SRD_BUILD_SOURCES;

/**
 * Level up (plan, Phase 2): what the next level gives, and only the choices it asks for, already filled in with the
 * builder's suggestions. The DM changes any, sees what applying does (and what it keeps of their edits), and applies it
 * as one undo step.
 */
export function LevelUpWindow({ definitionId, onClose }: { definitionId: string; onClose: () => void }) {
  const definition = useEncounterStore((s) => s.encounter.definitions.find((entry) => entry.id === definitionId));
  const rebuildCharacter = useEncounterStore((s) => s.rebuildCharacter);
  const saved = readBuild(definition);
  const [draft, setDraft] = useState<CharacterBuild | undefined>(() => (saved && saved.levels.length < 20 ? withSuggestions(withLevelUp(saved), sources) : undefined));
  const [update, setUpdate] = useState<string[]>([]);
  const built = useMemo(() => (draft ? buildCharacter(draft, sources) : undefined), [draft]);
  const preview = useMemo(() => (draft && definition ? rebuildActor(definition, draft, sources) : undefined), [draft, definition]);

  if (!definition || !saved || !draft || !built || !preview) {
    return (
      <FloatingWindow title="Level up" onClose={onClose} width={420} storageKey="level-up" initialPosition={BESIDE_SHEET}>
        <p className={styles.dim}>{saved && saved.levels.length >= 20 ? "This character is already 20th level." : "This actor wasn't made with the character builder."}</p>
      </FloatingWindow>
    );
  }

  const newIndex = draft.levels.length - 1;
  const slots = built.choices.filter((slot) => (slot.scope.kind === "level" && slot.scope.index === newIndex) || slot.pending);
  const changes = orderedChanges(preview.changes).filter((change) => !(change.kind === "field" && (change.key === "field:classes" || change.key === "field:level")));
  const classLevel = draft.levels.filter((entry) => entry.classId === draft.levels[newIndex]!.classId).length;
  const className = sources.catalog.classes.find((entry) => entry.id === draft.levels[newIndex]!.classId)?.name ?? "";
  const die = sources.catalog.classes.find((entry) => entry.id === draft.levels[newIndex]!.classId)?.hitDie ?? 8;

  return (
    <FloatingWindow title={`Level up · ${definition.name}`} ariaLabel="Level up" onClose={onClose} width={520} storageKey="level-up" initialPosition={BESIDE_SHEET}>
      <div className={styles.builder}>
        <p className={styles.lede}>
          {buildLabel(saved, sources)} → <strong>{className} {classLevel}</strong>
        </p>

        {draft.hp.method === "rolled" ? (
          <label className={styles.field}>
            Hit die roll (d{die})
            <input
              type="number" min={1} max={die} aria-label="Hit die roll"
              value={draft.hp.rolls?.[newIndex - 1] ?? ""} placeholder={String(die / 2 + 1)}
              onChange={(event) => {
                const rolls = [...(draft.hp.rolls ?? [])];
                rolls[newIndex - 1] = Math.min(die, Math.max(1, Math.round(Number(event.target.value) || die / 2 + 1)));
                setDraft({ ...draft, hp: { ...draft.hp, rolls } });
              }}
            />
          </label>
        ) : null}

        <section className={styles.section} aria-label="Choices">
          <h4>{slots.length ? "Choices at this level" : "No choices at this level"}</h4>
          {slots.map((slot) => (
            <ChoiceControl
              key={`${JSON.stringify(slot.scope)}|${slot.path.join("/")}`}
              slot={slot}
              onChange={(value) => setDraft(withChoice(draft, slot.scope, slot.path, value, slot.spec))}
            />
          ))}
        </section>

        <section className={styles.section} aria-label="What changes">
          <h4>What changes</h4>
          <ChangeList changes={changes} update={update} onUpdate={setUpdate} />
        </section>

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onClose}>Cancel</button>
          <button
            type="button" className={styles.primary}
            onClick={() => {
              rebuildCharacter(definitionId, draft, update);
              onClose();
            }}
          >
            Level up to {draft.levels.length}
          </button>
        </div>
      </div>
    </FloatingWindow>
  );
}
