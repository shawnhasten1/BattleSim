import { NextResponse } from "next/server";
import { Open5eClient } from "@/adapters";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query") ?? "";
    const documentKey = searchParams.get("documentKey") ?? undefined;
    const limit = Number(searchParams.get("limit") ?? 10);
    const client = new Open5eClient();
    const results = await client.searchSpells({ query, documentKey, limit });
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Open5e spell search failed" },
      { status: 502 }
    );
  }
}
