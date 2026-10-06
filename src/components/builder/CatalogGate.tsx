"use client";

import { useMemo } from "react";
import { missingFromCatalog, type CharacterBuild } from "@/lib/character-builder";
import type { BuildSources } from "@/lib/character-builder/build";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import { useBuildSources, useCatalogStore } from "@/store/catalog-store";
import styles from "./builder.module.css";

/**
 * The builder's sources for a build, and what the build names that they haven't got (a homebrew class deleted, or one
 * from another account). While the account's homebrew is still loading, a missing entry may yet turn up.
 */
export function useBuilderSources(build: CharacterBuild | undefined): { sources: BuildSources; missing: string[]; loading: boolean } {
  const sources = useBuildSources();
  const status = useCatalogStore((state) => state.status);
  const missing = useMemo(() => (build ? missingFromCatalog(build, sources.catalog) : []), [build, sources]);
  return { sources, missing, loading: status === "loading" };
}

/** In place of a builder window whose character names entries the catalog hasn't got: the actor is left as it is. */
export function MissingCatalogNotice({ title, missing, loading, onClose, initialPosition }: {
  title: string;
  missing: string[];
  loading: boolean;
  onClose: () => void;
  initialPosition?: { x: number; y: number };
}) {
  return (
    <FloatingWindow title={title} onClose={onClose} width={420} storageKey="builder-missing" initialPosition={initialPosition}>
      {loading ? (
        <p className={styles.dim}>Loading your homebrew classes…</p>
      ) : (
        <p className={styles.dim}>
          This character is built from {missing.length === 1 ? "an entry" : "entries"} your catalog hasn&apos;t got: {missing.join(", ")}.
          Import {missing.length === 1 ? "it" : "them"} under Homebrew to level it up or change its build. Its actor stays as it is.
        </p>
      )}
    </FloatingWindow>
  );
}
