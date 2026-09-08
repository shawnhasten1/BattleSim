import { NextResponse } from "next/server";
import { Open5eClient } from "@/adapters";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim();
  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const client = new Open5eClient();
  const results = await client.searchCreatures({
    query,
    documentKey: searchParams.get("documentKey") ?? undefined,
    limit: Number(searchParams.get("limit") ?? 12)
  });
  return NextResponse.json({ results });
}
