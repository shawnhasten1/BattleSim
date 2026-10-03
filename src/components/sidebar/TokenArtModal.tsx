"use client";

import { FolderOpen, ImagePlus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { SRD_MONSTER_INDEX, SRD_MONSTER_INDEX_WITH_FORMS } from "@/data/srd/monsters";
import { downscaleTokenImage } from "@/lib/imageResize";
import { TWIN_SLUGS, matchTokenFiles, type TokenMatchKind } from "@/lib/token-pack-match";
import type { StoredTokenImage } from "@/lib/tokenPackStore";
import { useDeviceTokenImages, useTokenPackStore } from "@/store/token-pack-store";
import modalStyles from "@/components/modals/modals.module.css";
import styles from "./TokenArtModal.module.css";

interface ReviewRow {
  id: number;
  file: File;
  previewUrl: string;
  kind: TokenMatchKind;
  duplicate: boolean;
  /** The monster it's for, when the text names one. */
  slug?: string;
  /** The monster box's text: a monster's name, or whatever's being typed. */
  text: string;
  include: boolean;
}

const IMAGE_FILE = /\.(png|jpe?g|webp|gif|avif)$/i;
const NAME_BY_SLUG = new Map(SRD_MONSTER_INDEX_WITH_FORMS.map((entry) => [entry.slug, entry.name]));
const SLUG_BY_NAME = new Map(SRD_MONSTER_INDEX_WITH_FORMS.map((entry) => [entry.name.toLowerCase(), entry.slug]));
const VISIBLE_SLUGS = new Set(SRD_MONSTER_INDEX.map((entry) => entry.slug));
const TARGETS = SRD_MONSTER_INDEX_WITH_FORMS.map(({ slug, name }) => ({ slug, name }));

/** Rows needing a decision first: suggestions, then unmatched, then the sure matches, then extras. */
function rank(row: ReviewRow): number {
  if (row.duplicate) return 3;
  return row.kind === "suggested" ? 0 : row.kind === "unmatched" ? 1 : 2;
}

function objectUrl(file: File): string {
  try {
    return URL.createObjectURL(file);
  } catch {
    return "";
  }
}

/**
 * Import token art for SRD monsters into this browser (SRD_TOKEN_IMAGES_PLAN.md, phase 3): pick
 * files or a folder, review how their names matched, save. The art never leaves the device.
 */
export function TokenArtModal({ onClose }: { onClose: () => void }) {
  const listId = useId();
  const deviceImages = useDeviceTokenImages();
  const save = useTokenPackStore((state) => state.save);
  const clear = useTokenPackStore((state) => state.clear);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [status, setStatus] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  // The previews of the current pick, freed when a new pick replaces them or the window closes.
  const previews = useRef<string[]>([]);
  const freePreviews = useCallback(() => {
    for (const url of previews.current) URL.revokeObjectURL(url);
    previews.current = [];
  }, []);
  useEffect(() => freePreviews, [freePreviews]);

  const yours = useMemo(() => Object.keys(deviceImages).filter((slug) => VISIBLE_SLUGS.has(slug)).length, [deviceImages]);
  const chosen = rows?.filter((row) => row.include && row.slug) ?? [];
  const chosenCount = new Map<string, number>();
  for (const row of chosen) chosenCount.set(row.slug!, (chosenCount.get(row.slug!) ?? 0) + 1);

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    const images = files.filter((file) => IMAGE_FILE.test(file.name));
    const matches = matchTokenFiles(images.map((file) => file.name), TARGETS);
    freePreviews();
    const next = matches.map((match): ReviewRow => ({
      id: match.index,
      file: images[match.index]!,
      previewUrl: objectUrl(images[match.index]!),
      kind: match.kind,
      duplicate: Boolean(match.duplicate),
      slug: match.slug,
      text: match.slug ? NAME_BY_SLUG.get(match.slug) ?? "" : "",
      include: match.kind === "exact" && !match.duplicate
    }));
    previews.current = next.map((row) => row.previewUrl).filter(Boolean);
    next.sort((a, b) => rank(a) - rank(b) || a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
    setRows(next);
    setSkipped(files.length - images.length);
    setStatus("");
  }

  function updateRow(id: number, change: (row: ReviewRow) => ReviewRow) {
    setRows((current) => current?.map((row) => (row.id === id ? change(row) : row)) ?? null);
  }

  function onMonsterText(id: number, text: string) {
    const slug = SLUG_BY_NAME.get(text.trim().toLowerCase());
    updateRow(id, (row) => ({ ...row, text, slug, include: Boolean(slug) }));
  }

  async function onSave() {
    if (chosen.length === 0) return;
    setProgress({ done: 0, total: chosen.length });
    const stored: StoredTokenImage[] = [];
    for (const [index, row] of chosen.entries()) {
      const blob = await downscaleTokenImage(row.file);
      for (const slug of [row.slug!, ...(TWIN_SLUGS[row.slug!] ?? [])]) stored.push({ slug, blob });
      setProgress({ done: index + 1, total: chosen.length });
    }
    const ok = await save(stored);
    setProgress(null);
    if (!ok) {
      setStatus("This browser couldn't store the images (a private window, or storage is full or turned off).");
      return;
    }
    setRows(null);
    freePreviews();
    setStatus(`Saved ${chosen.length} image${chosen.length === 1 ? "" : "s"}.`);
  }

  async function onClear() {
    await clear();
    setConfirmClear(false);
    setStatus("Removed your token art. The SRD monsters show their placeholder tokens again.");
  }

  const counts = rows
    ? {
        exact: rows.filter((row) => row.kind === "exact" && !row.duplicate).length,
        suggested: rows.filter((row) => row.kind === "suggested" && !row.duplicate).length,
        unmatched: rows.filter((row) => row.kind === "unmatched").length,
        duplicate: rows.filter((row) => row.duplicate).length
      }
    : null;

  return (
    <Modal
      open
      onClose={onClose}
      title="SRD token art"
      maxWidth={680}
      footer={
        rows ? (
          <>
            <button type="button" className={modalStyles.secondary} onClick={() => { setRows(null); freePreviews(); }} disabled={Boolean(progress)}>
              Discard
            </button>
            <button type="button" className={modalStyles.primary} onClick={() => void onSave()} disabled={chosen.length === 0 || Boolean(progress)}>
              {progress ? `Saving ${progress.done} of ${progress.total}…` : `Save ${chosen.length} image${chosen.length === 1 ? "" : "s"}`}
            </button>
          </>
        ) : (
          <button type="button" className={modalStyles.secondary} onClick={onClose}>Done</button>
        )
      }
    >
      <div className={styles.body}>
        <p className={styles.lead}>
          Every SRD monster has a placeholder token. Add token art you have the rights to use (a token pack you
          bought, or your own) and it shows instead. Images are matched to monsters by file name.
        </p>
        <p className={styles.privacy}>
          Your art stays in this browser on this device. It isn&apos;t uploaded, saved with your actors, or shown to
          anyone you share a campaign with.
        </p>

        <div className={styles.actions}>
          <label className={modalStyles.secondary}>
            <ImagePlus size={14} /> Choose images
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple hidden onChange={onPick} />
          </label>
          <label className={modalStyles.secondary}>
            <FolderOpen size={14} /> Choose a folder
            <input
              type="file" multiple hidden onChange={onPick}
              // Not in React's typings, but every current browser supports picking a folder this way.
              {...{ webkitdirectory: "", directory: "" }}
            />
          </label>
          <span className={styles.spacer} />
          <span className={styles.count}>{yours} of {SRD_MONSTER_INDEX.length} monsters use your art</span>
          {yours > 0 || Object.keys(deviceImages).length > 0 ? (
            confirmClear ? (
              <span className={styles.confirm}>
                Remove all?
                <button type="button" className={styles.danger} onClick={() => void onClear()}>Remove</button>
                <button type="button" className={styles.linkButton} onClick={() => setConfirmClear(false)}>Keep</button>
              </span>
            ) : (
              <button type="button" className={styles.linkButton} onClick={() => setConfirmClear(true)}>
                <Trash2 size={12} /> Remove all
              </button>
            )
          ) : null}
        </div>

        {status ? <p className={styles.status} role="status">{status}</p> : null}

        {rows && counts ? (
          <>
            <p className={styles.summary}>
              {rows.length === 0 ? "No images there." : [
                counts.exact ? `${counts.exact} matched` : "",
                counts.suggested ? `${counts.suggested} to confirm` : "",
                counts.unmatched ? `${counts.unmatched} not matched` : "",
                counts.duplicate ? `${counts.duplicate} extra for a monster already matched` : ""
              ].filter(Boolean).join(" · ")}
              {skipped ? ` · ${skipped} other file${skipped === 1 ? "" : "s"} skipped` : ""}
            </p>
            <datalist id={listId}>
              {SRD_MONSTER_INDEX_WITH_FORMS.map((entry) => <option key={entry.slug} value={entry.name} />)}
            </datalist>
            <ul className={styles.rows} aria-label="Images to import">
              {rows.map((row) => {
                const conflict = row.include && row.slug && (chosenCount.get(row.slug) ?? 0) > 1;
                return (
                  <li key={row.id} className={styles.row} data-kind={row.duplicate ? "duplicate" : row.kind}>
                    <input
                      type="checkbox" aria-label={`Use ${row.file.name}`} checked={row.include} disabled={!row.slug}
                      onChange={(event) => updateRow(row.id, (current) => ({ ...current, include: event.target.checked }))}
                    />
                    {row.previewUrl ? <img src={row.previewUrl} alt="" loading="lazy" className={styles.preview} /> : <span className={styles.preview} />}
                    <span className={styles.file} title={row.file.webkitRelativePath || row.file.name}>{row.file.name}</span>
                    <input
                      className={styles.monster} list={listId} value={row.text} placeholder="Pick a monster…"
                      aria-label={`Monster for ${row.file.name}`}
                      onChange={(event) => onMonsterText(row.id, event.target.value)}
                    />
                    <span className={styles.note}>
                      {conflict ? "another image is chosen too" : row.duplicate ? "extra" : row.kind === "suggested" ? "check" : row.kind === "unmatched" && !row.slug ? "no match" : row.slug && deviceImages[row.slug] ? "replaces yours" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
