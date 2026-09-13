import { NextResponse } from "next/server";
import { auth } from "@/server/auth";

/**
 * Resolves the session's user id for a route handler, or returns a 401
 * `NextResponse` for the caller to return as-is:
 *
 *   const userId = await requireUserId();
 *   if (userId instanceof NextResponse) return userId;
 */
export async function requireUserId(): Promise<string | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return session.user.id;
}
