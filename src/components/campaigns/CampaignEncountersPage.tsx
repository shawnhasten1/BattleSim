"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { ArrowLeft, LogOut, Map, Plus, Trash2 } from "lucide-react";
import { useEncounterStore } from "@/store/encounter-store";
import styles from "./campaigns.module.css";

interface EncounterSummary {
  id: string;
  name: string;
  updatedAt: string;
  mapImageUrl: string | null;
}

export function CampaignEncountersPage({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [campaignName, setCampaignName] = useState("");
  const [encounters, setEncounters] = useState<EncounterSummary[]>([]);
  const [status, setStatus] = useState("Loading encounters…");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [entering, setEntering] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`/api/projects/${campaignId}/encounters`);
    if (!response.ok) {
      setStatus(response.status === 404 ? "Campaign not found" : "Failed to load encounters");
      return;
    }
    const data = (await response.json()) as { campaign: { name: string }; encounters: EncounterSummary[] };
    setCampaignName(data.campaign.name);
    setEncounters(data.encounters);
    setStatus(data.encounters.length === 0 ? "No encounters yet — create your first one below." : "");
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  async function enterEncounter(encounterId: string) {
    setEntering(encounterId);
    await useEncounterStore.getState().loadEncounter(encounterId);
    router.push("/");
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    const id = await useEncounterStore.getState().createEncounterInCampaign(campaignId, newName);
    setCreating(false);
    if (id) await enterEncounter(id);
    else setStatus("Create encounter failed");
  }

  async function onDelete(id: string) {
    const response = await fetch(`/api/encounters/${id}`, { method: "DELETE" });
    if (response.ok) setEncounters((prev) => prev.filter((encounter) => encounter.id !== id));
    else setStatus("Delete failed");
  }

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <h1>BattleSim</h1>
        <div className={styles.spacer} />
        <button type="button" onClick={() => void signOut({ redirectTo: "/login" })}>
          <LogOut size={14} /> Sign out
        </button>
      </div>

      <div className={styles.body}>
        <a className={styles.breadcrumb} href="/campaigns">
          <ArrowLeft size={12} /> Campaigns
        </a>
        <div className={styles.heading}>
          <h2>{campaignName || "Campaign"}</h2>
          <form className={styles.createForm} onSubmit={onCreate}>
            <input
              type="text"
              placeholder="New encounter name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <button type="submit" className={styles.primary} disabled={creating}>
              <Plus size={14} /> {creating ? "Creating…" : "New Encounter"}
            </button>
          </form>
        </div>

        {status ? <p className={styles.status}>{status}</p> : null}

        {encounters.length === 0 ? null : (
          <div className={styles.grid}>
            {encounters.map((encounter) => (
              <div key={encounter.id} className={styles.card}>
                <button
                  type="button"
                  className={styles.cardDelete}
                  title="Delete encounter"
                  onClick={() => {
                    if (confirm(`Delete "${encounter.name}"? This can't be undone.`)) {
                      void onDelete(encounter.id);
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
                <button
                  type="button"
                  className={styles.cardMain}
                  disabled={entering === encounter.id}
                  onClick={() => void enterEncounter(encounter.id)}
                >
                  <div className={styles.thumb}>
                    {encounter.mapImageUrl ? (
                      <img src={encounter.mapImageUrl} alt="" />
                    ) : (
                      <Map size={28} />
                    )}
                  </div>
                  <div className={styles.cardBody}>
                    <strong>{entering === encounter.id ? "Loading…" : encounter.name}</strong>
                    <span>updated {new Date(encounter.updatedAt).toLocaleDateString()}</span>
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
