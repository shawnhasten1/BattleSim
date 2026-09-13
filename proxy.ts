import NextAuth from "next-auth";
import { authConfig } from "@/server/auth.config";

/**
 * Gates every route except /login, /signup, and Auth.js's own /api/auth/*
 * behind a session — see `authConfig.callbacks.authorized`. Built from the
 * edge-safe config only, so this never pulls in Prisma or bcryptjs (both
 * Node-only) into the Edge proxy bundle. (Next.js 16 renamed the
 * `middleware.ts` file convention to `proxy.ts` — same API, new name.)
 *
 * Interim caveat: this blocks anonymous access, but doesn't yet scope data
 * by owner — until Phase 2 lands, any logged-in user can see every
 * campaign/actor. Don't rely on isolation between two test accounts before then.
 */
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"]
};
