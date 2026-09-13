import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/server/prisma";
import { isEmailAllowed } from "@/server/invite";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200)
});

export async function POST(request: Request) {
  const parsed = registerSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a valid email and a password of at least 8 characters." },
      { status: 400 }
    );
  }
  const { name, email, password } = parsed.data;

  if (!isEmailAllowed(email)) {
    return NextResponse.json(
      { error: "This app is invite-only right now — ask the owner to add your email." },
      { status: 403 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({ data: { name, email, passwordHash } });

  return NextResponse.json({ ok: true }, { status: 201 });
}
