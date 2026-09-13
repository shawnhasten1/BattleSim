"use client";

import { use } from "react";
import { CampaignEncountersPage } from "@/components/campaigns/CampaignEncountersPage";

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CampaignEncountersPage campaignId={id} />;
}
