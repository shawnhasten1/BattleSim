import { NextResponse } from "next/server";
import { normalizeOpen5eSpell, Open5eClient } from "@/adapters";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const client = new Open5eClient();
    const imported = await client.importSpell(slug);
    return NextResponse.json({
      imported,
      spell: normalizeOpen5eSpell(imported)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Open5e spell import failed" },
      { status: 502 }
    );
  }
}
