import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "./lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Server-to-server API-toegang (bv. ADSGUARD) via een gedeeld geheim.
  // Alleen voor /api/-endpoints en alleen als het geheim exact klopt; de
  // login-gate voor de app zelf blijft ongewijzigd.
  const apiSecret = process.env.FINANCE_API_SECRET;
  if (
    pathname.startsWith("/api/") &&
    apiSecret &&
    req.headers.get("x-finance-secret") === apiSecret
  ) {
    return NextResponse.next();
  }

  const secret = process.env.APP_PASSWORD;

  // Geen wachtwoord ingesteld → app blijft gewoon open (niemand buitensluiten).
  if (!secret) return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  const ok = !!cookie && cookie === (await authToken(secret));
  if (ok) return NextResponse.next();

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
