import { NextResponse } from "next/server";
import { normalizeOpen5eFeatureReference, normalizeOpen5eWeapon, Open5eClient } from "@/adapters";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const route = searchParams.get("route");
    const key = searchParams.get("key");
    if (!route || !key) {
      return NextResponse.json({ error: "route and key are required" }, { status: 400 });
    }

    const client = new Open5eClient();
    const imported = await client.importCompendiumRecord(route, key);
    const weapon = imported.resource === "weapon" || imported.resource === "item"
      ? normalizeOpen5eWeapon(imported)
      : undefined;
    const feature = weapon ? undefined : normalizeOpen5eFeatureReference(imported);
    return NextResponse.json({ imported, weapon, feature });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Open5e compendium import failed" },
      { status: 502 }
    );
  }
}
