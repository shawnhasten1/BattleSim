import { NextResponse } from "next/server";
import { Open5eClient } from "@/adapters";

/** Open5e classes and subclasses by name, for the Homebrew window's import (the SRD 5.2 ones are bundled already). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const client = new Open5eClient();
    const results = await client.searchClasses({
      query: searchParams.get("query")?.trim() ?? "",
      documentKey: searchParams.get("documentKey") ?? undefined,
      limit: Number(searchParams.get("limit") ?? 50)
    });
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Open5e search failed", results: [] }, { status: 502 });
  }
}
