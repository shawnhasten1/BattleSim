import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { isEmailAllowed } from "@/server/invite";
import { authConfig } from "@/server/auth.config";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: {
    // Required once a Credentials provider is present — Auth.js doesn't
    // support database sessions alongside it. The adapter is still used to
    // persist Users/Accounts for the Google sign-in flow.
    strategy: "jwt"
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      authorize: async (rawCredentials) => {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, name: user.name, email: user.email, image: user.image };
      }
    })
  ],
  callbacks: {
    ...authConfig.callbacks,
    signIn: async ({ user, account }) => {
      // Credentials sign-ins are already vetted by `authorize` above (and
      // the invite gate at registration time) — only Google needs a check
      // here, since it's the one path that can silently create a new User.
      if (account?.provider === "google") {
        if (!user.email) return false;
        const existing = await prisma.user.findUnique({ where: { email: user.email } });
        if (existing) return true;
        return isEmailAllowed(user.email);
      }
      return true;
    },
    jwt: async ({ token, user }) => {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    }
  }
});
