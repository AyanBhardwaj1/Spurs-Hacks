// Fly's health check. It sits outside the password gate in src/proxy.ts, so a deploy can pass its
// check before anyone signs in.
export function GET() {
  return Response.json({ ok: true });
}
