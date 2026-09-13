import type { NextAuthConfig } from "next-auth";

const PUBLIC_PATHS = ["/login", "/signup"];

/**
 * Edge-safe half of the Auth.js config — used directly by `middleware.ts`,
 * which runs on the Edge runtime and can't load Prisma's Node-API engine or
 * bcryptjs. Providers, the adapter, and DB-touching callbacks live in
 * `auth.ts` instead, which spreads this config in for Node contexts (API
 * routes, server components).
 */
export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/login"
  },
  providers: [],
  callbacks: {
    authorized: ({ auth, request }) => {
      if (PUBLIC_PATHS.includes(request.nextUrl.pathname)) return true;
      return !!auth?.user;
    }
  }
} satisfies NextAuthConfig;
