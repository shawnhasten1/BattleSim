"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { BookOpen, ImagePlus, LogOut, Pencil, Plus, Swords, Trash2 } from "lucide-react";
import { useEncounterStore } from "@/store/encounter-store";
import { downscaleDataUrl } from "@/lib/imageResize";
import { RenameInput } from "@/components/sidebar/ActorFolderNode";
import styles from "./campaigns.module.css";

interface CampaignSummary {
  id: string;
  name: string;
  description?: string | null;
  coverImageUrl?: string | null;
  updatedAt: string;
  encounters?: Array<{ id: string; name: string; updatedAt: string }>;
}

export function CampaignsListPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [status, setStatus] = useState("Loading campaigns…");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/projects");
    if (!response.ok) {
      setStatus("Failed to load campaigns");
      return;
    }
    const data = (await response.json()) as { projects: CampaignSummary[] };
    setCampaigns(data.projects);
    setStatus(data.projects.length === 0 ? "No campaigns yet — create your first one below." : "");
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    const id = await useEncounterStore.getState().createCampaign(newName);
    setCreating(false);
    if (id) router.push(`/campaigns/${id}` as Route);
    else setStatus("Create campaign failed");
  }

  async function onDelete(id: string) {
    const response = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (response.ok) setCampaigns((prev) => prev.filter((campaign) => campaign.id !== id));
    else setStatus("Delete failed");
  }

  async function onRename(id: string, name: string) {
    setRenamingId(null);
    const response = await fetch(`/api/projects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    if (response.ok) setCampaigns((prev) => prev.map((campaign) => (campaign.id === id ? { ...campaign, name } : campaign)));
    else setStatus("Rename failed");
  }

  function onCoverImageChange(id: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === "string" ? reader.result : null;
      if (raw) void uploadCoverImage(id, raw);
    };
    reader.readAsDataURL(file);
  }

  async function uploadCoverImage(id: string, rawDataUrl: string) {
    setUploadingId(id);
    const dataUrl = await downscaleDataUrl(rawDataUrl);
    const response = await fetch(`/api/projects/${id}/cover-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl })
    });
    setUploadingId(null);
    if (!response.ok) {
      setStatus("Cover image upload failed");
      return;
    }
    const data = (await response.json()) as { url: string };
    setCampaigns((prev) => prev.map((campaign) => (campaign.id === id ? { ...campaign, coverImageUrl: data.url } : campaign)));
  }

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <h1>BattleSim</h1>
        <div className={styles.spacer} />
        <a href="/">
          <Swords size={14} /> Sandbox
        </a>
        <a href="/docs">
          <BookOpen size={14} /> Docs
        </a>
        <button type="button" onClick={() => void signOut({ redirectTo: "/login" })}>
          <LogOut size={14} /> Sign out
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.heading}>
          <h2>Your Campaigns</h2>
          <form className={styles.createForm} onSubmit={onCreate}>
            <input
              type="text"
              placeholder="New campaign name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <button type="submit" className={styles.primary} disabled={creating}>
              <Plus size={14} /> {creating ? "Creating…" : "New Campaign"}
            </button>
          </form>
        </div>

        {status ? <p className={styles.status}>{status}</p> : null}

        {campaigns.length === 0 ? null : (
          <div className={styles.grid}>
            {campaigns.map((campaign) => (
              <div key={campaign.id} className={styles.card}>
                <div className={styles.cardActions}>
                  <label className={styles.cardAction} title="Set cover image">
                    <ImagePlus size={13} />
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => onCoverImageChange(campaign.id, event)}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.cardAction}
                    title="Rename campaign"
                    onClick={() => setRenamingId(campaign.id)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.cardAction} ${styles.cardActionDanger}`}
                    title="Delete campaign"
                    onClick={() => {
                      if (confirm(`Delete "${campaign.name}" and all of its encounters? This can't be undone.`)) {
                        void onDelete(campaign.id);
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {renamingId === campaign.id ? (
                  <div className={styles.cardMain}>
                    <div className={styles.thumb}>
                      {campaign.coverImageUrl ? <img src={`/api/projects/${campaign.id}/cover-image`} alt="" /> : <Swords size={28} />}
                    </div>
                    <div className={styles.cardBody}>
                      <RenameInput
                        initialName={campaign.name}
                        onCommit={(name) => void onRename(campaign.id, name)}
                        onCancel={() => setRenamingId(null)}
                      />
                    </div>
                  </div>
                ) : (
                  <button type="button" className={styles.cardMain} onClick={() => router.push(`/campaigns/${campaign.id}` as Route)}>
                    <div className={styles.thumb}>
                      {uploadingId === campaign.id ? (
                        <span>Uploading…</span>
                      ) : campaign.coverImageUrl ? (
                        <img src={`/api/projects/${campaign.id}/cover-image`} alt="" />
                      ) : (
                        <Swords size={28} />
                      )}
                    </div>
                    <div className={styles.cardBody}>
                      <strong>{campaign.name}</strong>
                      <span>
                        {campaign.encounters?.length ?? 0} encounter{(campaign.encounters?.length ?? 0) === 1 ? "" : "s"} ·
                        updated {new Date(campaign.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
