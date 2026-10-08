import { ABILITIES, pointBuyCost, POINT_BUY_BUDGET, STANDARD_ARRAY, type CharacterBuild } from "@/lib/character-builder";

/** What's wrong with a set of base scores under its method, if anything. */
export function scoresProblem(abilities: CharacterBuild["abilities"]): string | undefined {
  const values = ABILITIES.map((ability) => abilities.base[ability]);
  if (abilities.method === "standard-array") {
    const sorted = [...values].sort((a, b) => a - b).join(",");
    return sorted === [...STANDARD_ARRAY].sort((a, b) => a - b).join(",") ? undefined : "The standard array is one each of 15, 14, 13, 12, 10 and 8.";
  }
  if (abilities.method === "point-buy") {
    const cost = pointBuyCost(abilities.base);
    if (cost === undefined) return "Point buy scores are 8 to 15.";
    return cost > POINT_BUY_BUDGET ? `That's ${cost} points: point buy has ${POINT_BUY_BUDGET}.` : undefined;
  }
  return values.some((value) => value < 1 || value > 30) ? "Scores are 1 to 30." : undefined;
}
