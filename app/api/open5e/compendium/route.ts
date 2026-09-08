import { NextResponse } from "next/server";
import { Open5eClient, type Open5eCompendiumCategory } from "@/adapters";

const categories: Open5eCompendiumCategory[] = ["all", "creatures", "spells", "items", "features", "conditions"];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query")?.trim();
    if (!query) {
      return NextResponse.json({ results: [] });
    }

    const categoryParam = searchParams.get("category") ?? "all";
    const category = categories.includes(categoryParam as Open5eCompendiumCategory)
      ? categoryParam as Open5eCompendiumCategory
      : "all";
    const client = new Open5eClient();
    const results = await client.searchCompendium({
      query,
      category,
      documentKey: searchParams.get("documentKey") ?? undefined,
      limit: Number(searchParams.get("limit") ?? 12)
    });
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Open5e compendium search failed" },
      { status: 502 }
    );
  }
}
