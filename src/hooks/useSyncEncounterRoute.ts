"use client";

import { useEffect } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEncounterStore } from "@/store/encounter-store";

export interface EncounterRouteParams {
  campaignId: string;
  encounterId: string;
}

/**
 * Keeps the URL in sync with whichever campaign/encounter is actually loaded
 * in the store, regardless of how it got there — a direct link, the campaign
 * picker, or the in-editor scene dropdown/save flow all funnel through the
 * same store fields, so this is the one place that needs to react to them.
 *
 * `routeParams` is null on the sandbox page (`/`), which has no specific
 * encounter route to match — loading a real campaign/encounter there
 * promotes you straight to its canonical URL.
 */
export function useSyncEncounterRoute(routeParams: EncounterRouteParams | null) {
  const router = useRouter();
  const currentProjectId = useEncounterStore((state) => state.currentProjectId);
  const currentEncounterId = useEncounterStore((state) => state.currentEncounterId);

  useEffect(() => {
    if (currentProjectId && currentEncounterId) {
      const matches = routeParams?.campaignId === currentProjectId && routeParams?.encounterId === currentEncounterId;
      if (!matches) {
        router.push(`/campaigns/${currentProjectId}/encounters/${currentEncounterId}` as Route);
      }
      return;
    }
    // Nothing loaded — if we were on a specific encounter's URL, it was
    // most likely just deleted out from under us. The sandbox (routeParams
    // null) has nothing loaded by default, so it's a no-op there.
    if (routeParams) {
      router.push("/campaigns" as Route);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, currentEncounterId, routeParams?.campaignId, routeParams?.encounterId, router]);
}
