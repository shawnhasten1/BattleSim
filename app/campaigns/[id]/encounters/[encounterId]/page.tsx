"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import { useEncounterStore } from "@/store/encounter-store";
import { EncounterEditor } from "@/components/editor/EncounterEditor";

type LoadStatus = "loading" | "ready" | "error";

export default function EncounterRoutePage({
  params
}: {
  params: Promise<{ id: string; encounterId: string }>;
}) {
  const { id: campaignId, encounterId } = use(params);
  const loadEncounter = useEncounterStore((s) => s.loadEncounter);
  // Always start at "loading" so this matches the server render (which never has
  // access to the persisted store) — the effect below flips to "ready" on the
  // client as soon as it can, without risking a hydration mismatch.
  const [status, setStatus] = useState<LoadStatus>("loading");

  useEffect(() => {
    if (useEncounterStore.getState().currentEncounterId === encounterId) {
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    void loadEncounter(encounterId).then(() => {
      if (cancelled) return;
      setStatus(useEncounterStore.getState().currentEncounterId === encounterId ? "ready" : "error");
    });
    return () => {
      cancelled = true;
    };
  }, [encounterId, loadEncounter]);

  if (status === "loading") {
    return <StatusScreen>Loading encounter…</StatusScreen>;
  }

  if (status === "error") {
    return (
      <StatusScreen>
        Couldn&apos;t load this encounter — it may have been deleted, or you may not have access.
        <br />
        <a href={`/campaigns/${campaignId}`}>Back to campaign</a>
      </StatusScreen>
    );
  }

  return <EncounterEditor routeParams={{ campaignId, encounterId }} />;
}

function StatusScreen({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--ui-bg-deep)",
        color: "var(--ui-text)",
        textAlign: "center",
        padding: 24
      }}
    >
      <div>{children}</div>
    </div>
  );
}
