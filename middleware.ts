import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "./lib/auth";

export async function middleware(req: NextRequest) {
  const secret = process.env.APP_PASSWORD;

  // Geen wachtwoord ingesteld → app blijft gewoon open (niemand buitensluiten).
  if (!secret) return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  const ok = !!cookie && cookie === (await authToken(secret));
  if (ok) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // API-calls krijgen een nette 401 i.p.v. een redirect naar HTML.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Alles afschermen behalve de loginpagina, de login-API en statische assets.
  matcher: ["/((?!login|api/login|_next/static|_next/image|favicon.ico).*)"],
};
