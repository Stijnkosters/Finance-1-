import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, AUTH_MAX_AGE, authToken } from "../../../lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = process.env.APP_PASSWORD;
  if (!secret) {
    return NextResponse.json(
      { error: "Geen APP_PASSWORD ingesteld op de server." },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";

  if (!password || password !== secret) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await authToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_MAX_AGE,
  });
  return res;
}

// Uitloggen.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
