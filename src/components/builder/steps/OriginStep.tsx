"use client";

import type { FeatureDefinition, SizeCategory } from "@/engine";
import {
  describeBackground,
  describeFeature,
  describeSpecies,
  increasesSource,
  stepOf,
  supportOf,
  withChoice,
  withSuggestions,
  type BackgroundDefinition,
  type SpeciesDefinition
} from "@/lib/character-builder";
import { builderIconUrl } from "@/data/srd/tokens";
import { useBuilder } from "../builder-context";
import { catalogGroups, speciesWord } from "../CatalogSelect";
import { ChoiceControl } from "../ChoiceControl";
import { CardGrid, type CardOption } from "../pickers/CardGrid";
import { FeatureRow, Gives, Panel, StepHeading } from "../parts";
import { mixedRulesNote } from "../mixed";
import styles from "../builder.module.css";

const ABBR = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" } as const;
const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
/** A card's badge: an SRD entry's edition, or where a homebrew or imported one comes from. */
export const badgeOf = (entry: { edition: string; source: { provider: string } }) =>
  entry.source.provider === "srd" ? entry.edition : entry.source.provider === "homebrew" ? "Homebrew" : "Imported";

function speciesOption(species: SpeciesDefinition, label: string, sources: ReturnType<typeof useBuilder>["sources"]): CardOption {
  const increases = Object.entries(species.abilities ?? {}).filter(([, amount]) => amount).map(([ability, amount]) => `+${amount} ${ABBR[ability as keyof typeof ABBR]}`);
  if (species.abilityChoice) increases.push(`+${species.abilityChoice.amount} to ${species.abilityChoice.count} others`);
  const senses = species.senses?.darkvision ? ` · Darkvision ${species.senses.darkvision}` : "";
  return {
    id: species.id, title: label.replace(/ \((2014|2024|Homebrew|Open5e|Imported)\)$/, ""), badge: badgeOf(species),
    icon: builderIconUrl("species", species.id),
    lines: [`${capitalize(species.sizes.join(" or "))} · ${species.speed} ft${senses}`],
    accent: increases.join(", ") || undefined,
    card: () => describeSpecies(species, sources)
  };
}

function backgroundOption(background: BackgroundDefinition, label: string, sources: ReturnType<typeof useBuilder>["sources"]): CardOption {
  const feat = background.feat ? sources.catalog.feats.find((entry) => entry.id === background.feat)?.name : undefined;
  const feature = background.grants?.map((grant) => (typeof grant.feature === "object" ? grant.feature.name : undefined)).find(Boolean);
  return {
    id: background.id, title: label.replace(/ \((2014|2024|Homebrew|Open5e|Imported)\)$/, ""), badge: badgeOf(background),
    lines: [background.abilities?.length ? background.abilities.map((ability) => ABBR[ability]).join(" · ") : "No ability increases"],
    accent: feat ?? feature,
    card: () => describeBackground(background, sources)
  };
}

/**
 * Origin (CHARACTER_BUILDER_UX_PLAN.md §3.2): the species or race, and the background, as cards that say what each gives
 * in its own edition; then what the chosen ones ask for. Ability increases are picked in Abilities, spells in Spells.
 */
export function OriginStep() {
  const model = useBuilder();
  const { build, built, sources, filter, set, go } = model;
  const species = build.species ? sources.catalog.species.find((entry) => entry.id === build.species!.id) : undefined;
  const background = build.background.id ? sources.catalog.backgrounds.find((entry) => entry.id === build.background.id) : undefined;
  const word = speciesWord(species?.edition ?? build.edition);
  const from = increasesSource(build, sources);
  const note = mixedRulesNote(build, sources);

  const speciesGroups = catalogGroups(sources.catalog.species, filter, build.species?.id).map((group) => ({
    label: group.label, options: group.entries.map(({ entry, label }) => speciesOption(entry, label, sources))
  }));
  speciesGroups.push({ label: "None", options: [{ id: "", title: "None", lines: ["Size, speed and senses by hand"] }] });
  const backgroundGroups = catalogGroups(sources.catalog.backgrounds, filter, build.background.id).map((group) => ({
    label: group.label, options: group.entries.map(({ entry, label }) => backgroundOption(entry, label, sources))
  }));

  function changeSpecies(id: string) {
    const { species: _species, ...rest } = build;
    set(withSuggestions(id ? { ...rest, species: { id } } : rest, sources));
  }
  function changeBackground(id: string) {
    set(withSuggestions({ ...build, background: { ...(id ? { id } : {}), increases: {} } }, sources));
  }

  const slots = (scope: "species" | "background") => built.choices.filter((slot) => slot.scope.kind === scope && stepOf(slot) === "origin");
  const control = (slot: (typeof built.choices)[number]) => (
    <ChoiceControl
      key={`${JSON.stringify(slot.scope)}|${slot.path.join("/")}`}
      slot={slot} edition={filter} sources={sources} characterEdition={build.edition}
      onChange={(value) => set(withChoice(build, slot.scope, slot.path, value, slot.spec))}
    />
  );
  const traitsOf = (entry: SpeciesDefinition) => [...entry.levels].sort((a, b) => a.level - b.level).flatMap((level) =>
    level.grants.flatMap((grant) => (typeof grant.feature === "object" ? [{ feature: grant.feature as FeatureDefinition, level: level.level }] : [])));
  const backgroundCard = background ? describeBackground(background, sources) : undefined;

  return (
    <div className={styles.stepBody}>
      {note ? <p role="note" className={styles.note}>{note}</p> : null}

      <Panel label={word}>
        <StepHeading icon="compass">Species or race</StepHeading>
        <CardGrid label={word} groups={speciesGroups} value={build.species?.id ?? ""} onChange={changeSpecies} />
        {species ? (
          <div className={styles.chosen}>
            <div className={styles.chosenHead}>
              <strong className={styles.chosenTitle}>{species.name}</strong>
              <span className={styles.optionBadge}>{badgeOf(species)}</span>
              <span className={styles.dim}>{describeSpecies(species, sources).gives.filter((row) => row.label === "Creature" || row.label === "Speed" || row.label === "Senses").map((row) => row.value).join(" · ")}</span>
            </div>
            {species.description ? <p className={styles.dim}>{species.description}</p> : null}
            <p className={styles.accentLine}>
              {species.edition === "2014"
                ? from === "species" ? "Its ability increases apply (the 2014 rule)." : "Its ability increases don't apply: they come from the background. Switch it in Abilities."
                : "No ability increases: under the 2024 rules they come from your background."}
            </p>
            <div className={styles.featureList}>
              {traitsOf(species).map(({ feature, level }) => (
                <FeatureRow
                  key={`${feature.id}|${level}`} name={feature.name} support={supportOf(feature)} text={feature.description}
                  from={level > 1 ? `level ${level}` : undefined}
                  card={() => describeFeature(feature, { owner: species.name, level, edition: species.edition })}
                />
              ))}
            </div>
            {species.sizes.length > 1 ? (
              <label className={styles.field}>
                Size
                <select
                  aria-label="Size" value={build.species?.size ?? species.sizes[0]}
                  onChange={(event) => set({ ...build, species: { ...build.species!, size: event.target.value as SizeCategory } })}
                >
                  {species.sizes.map((size) => <option key={size} value={size}>{capitalize(size)}</option>)}
                </select>
              </label>
            ) : null}
            {slots("species").map(control)}
          </div>
        ) : null}
      </Panel>

      <Panel label="Background">
        <StepHeading icon="compass">Background</StepHeading>
        <CardGrid label="Background" groups={backgroundGroups} value={build.background.id} onChange={changeBackground} columns={4} />
        {background && backgroundCard ? (
          <div className={styles.chosen}>
            <div className={styles.chosenHead}>
              <strong className={styles.chosenTitle}>{background.name}</strong>
              <span className={styles.optionBadge}>{badgeOf(background)}</span>
            </div>
            {background.description ? <p className={styles.dim}>{background.description}</p> : null}
            <Gives
              rows={backgroundCard.gives.map((row) => ({
                label: row.label,
                value: row.value,
                link: row.label === "Ability scores" && from === "background" ? { text: "Set in Abilities ›", go: () => go("abilities") }
                  : row.label === "Origin feat" && /Magic Initiate/.test(row.value) ? { text: "Its spells: in Spells ›", go: () => go("spells") }
                    : row.label === "Equipment" && model.creating ? { text: "Choose in Equipment ›", go: () => go("equipment") }
                      : undefined
              }))}
            />
            {slots("background").map(control)}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
