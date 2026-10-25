import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// Keeps the deployed site, and the API that writes to the club's ScorePlay, behind one shared password.
// The browser asks for it with its own sign-in prompt, and any user name works. With SITE_PASSWORD
// unset nothing changes locally, but a Fly or Vercel deploy refuses to serve, so a missing secret
// closes the site instead of opening it.
export function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    if (process.env.FLY_APP_NAME || process.env.VERCEL) return new Response("Set SITE_PASSWORD to open this site.", { status: 503 });
    return;
  }
  if (signedIn(request.headers.get("authorization"), password)) return;
  return new Response("Sign in to see Rundown.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Rundown", charset="UTF-8"' },
  });
}

function signedIn(authorization: string | null, password: string) {
  if (!authorization?.startsWith("Basic ")) return false;
  const credentials = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
  const colon = credentials.indexOf(":");
  if (colon < 0) return false;
  const given = Buffer.from(credentials.slice(colon + 1));
  const expected = Buffer.from(password);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const config = {
  // Scripts, styles and the health check load without the password. Everything else waits for it.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
