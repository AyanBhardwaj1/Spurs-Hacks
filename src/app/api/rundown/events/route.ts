import { connection } from "next/server";
import { scoreplayConfigured, searchEvents } from "@/lib/scoreplay";

/** Matches on the team's ScorePlay platform, to pick one for a run. */
export async function GET(request: Request) {
  await connection();
  if (!scoreplayConfigured()) {
    return Response.json({ source: "demo", events: [{ id: 0, name: "Sample match (no API keys set)", mediaCount: 5 }] });
  }
  const q = new URL(request.url).searchParams.get("q") ?? undefined;
  const events = await searchEvents(q);
  return Response.json({
    source: "live",
    events: events.map((e) => ({ id: e.ID, name: e.name, date: e.date, mediaCount: e.media_count, path: e.full_path })),
  });
}
