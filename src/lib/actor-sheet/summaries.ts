import { movementProfileOf, type CreatureDefinition } from "@/engine";

/** Speed as a statblock prints it: "40 ft, climb 40 ft, fly 80 ft (hover)". */
export function speedLine(definition: Pick<CreatureDefinition, "speed" | "movement">): string {
  const profile = movementProfileOf(definition);
  const modes = (["burrow", "climb", "fly", "swim"] as const)
    .filter((mode) => (profile[mode] ?? 0) > 0)
    .map((mode) => `${mode} ${profile[mode]} ft${mode === "fly" && profile.hover ? " (hover)" : ""}`);
  return [`${profile.walk} ft`, ...modes].join(", ");
}
