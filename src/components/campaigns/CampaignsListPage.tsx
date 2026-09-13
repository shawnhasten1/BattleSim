"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, Plus, Swords, Trash2 } from "lucide-react";
import { useEncounterStore } from "@/store/encounter-store";
import styles from "./campaigns.module.css";

interface CampaignSummary {
  id: string;
  name: string;
  description?: string | null;
  updatedAt: string;
  encounters?: Array<{ id: string; name: string; updatedAt: string }>;
}

export function CampaignsListPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [status, setStatus] = useState("Loading campaigns…");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

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

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <h1>BattleSim</h1>
        <div className={styles.spacer} />
        <a href="/">
          <Swords size={14} /> Sandbox
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
                <button
                  type="button"
                  className={styles.cardDelete}
                  title="Delete campaign"
                  onClick={() => {
                    if (confirm(`Delete "${campaign.name}" and all of its encounters? This can't be undone.`)) {
                      void onDelete(campaign.id);
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
                <button type="button" className={styles.cardMain} onClick={() => router.push(`/campaigns/${campaign.id}` as Route)}>
                  <div className={styles.thumb}>
                    <Swords size={28} />
                  </div>
                  <div className={styles.cardBody}>
                    <strong>{campaign.name}</strong>
                    <span>
                      {campaign.encounters?.length ?? 0} encounter{(campaign.encounters?.length ?? 0) === 1 ? "" : "s"} ·
                      updated {new Date(campaign.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
