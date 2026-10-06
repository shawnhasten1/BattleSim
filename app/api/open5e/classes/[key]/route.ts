import { NextResponse } from "next/server";
import { normalizeOpen5eClass, Open5eClient } from "@/adapters";

/** One Open5e class or subclass, as a catalog skeleton (`{ entry: { kind, entry } }`) for the Homebrew window to save. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await params;
    const imported = await new Open5eClient().importClass(key);
    return NextResponse.json({ entry: normalizeOpen5eClass(imported) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Open5e import failed" }, { status: 502 });
  }
}
