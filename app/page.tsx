import { EncounterEditor } from "@/components/editor/EncounterEditor";

/**
 * The freeplay sandbox — whatever's already in the store/localStorage, no
 * campaign attached. The moment a real campaign/encounter gets loaded here
 * (via the in-editor scene dropdown, a save, etc.) useSyncEncounterRoute
 * promotes the URL to its canonical /campaigns/[id]/encounters/[encounterId].
 */
export default function SandboxPage() {
  return <EncounterEditor />;
}
