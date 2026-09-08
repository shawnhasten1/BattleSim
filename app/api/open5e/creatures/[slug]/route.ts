import { NextResponse } from "next/server";
import { normalizeOpen5eCreature, Open5eClient } from "@/adapters";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const client = new Open5eClient();
    const imported = await client.importCreature(slug);
    return NextResponse.json({
      imported,
      definition: normalizeOpen5eCreature(imported)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Open5e import failed" },
      { status: 502 }
    );
  }
}
