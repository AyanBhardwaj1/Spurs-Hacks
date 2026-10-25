import { after, connection } from "next/server";
import { startRun } from "@/lib/rundown/engine";
import { listRuns } from "@/lib/rundown/store";
import type { MatchLogEvent, RunInput } from "@/lib/rundown/types";

export const maxDuration = 300;

export async function GET() {
  await connection();
  const runs = await listRuns();
  return Response.json(
    runs.map((r) => ({
      id: r.id,
      source: r.source,
      status: r.status,
      createdAt: r.createdAt,
      event: r.event,
      proposals: r.proposals.length,
      spikes: r.spikes.length,
    })),
  );
}

/** Starts a run. Poll `GET /api/rundown/runs/{id}` for progress. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<RunInput> | null;
  const input = parseInput(body);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  const { run, done } = await startRun(input);
  after(() => done);
  return Response.json(run, { status: 202 });
}

function parseInput(body: Partial<RunInput> | null): RunInput | string {
  if (!body) return "Send a JSON body";
  const eventId = Number(body.eventId);
  if (!Number.isInteger(eventId) || eventId < 0) return "eventId must be a ScorePlay event ID";
  if (body.sport !== "soccer" && body.sport !== "basketball") return 'sport must be "soccer" or "basketball"';
  const fanPosts = Array.isArray(body.fanPosts) ? body.fanPosts.filter((p): p is string => typeof p === "string") : undefined;
  const matchLog = Array.isArray(body.matchLog) ? body.matchLog.filter(isLogEvent) : undefined;
  const analyzeLimit = body.analyzeLimit === undefined ? undefined : Math.min(30, Math.max(1, Number(body.analyzeLimit) || 12));
  return { eventId, sport: body.sport, fanPosts, matchLog, includeArchive: Boolean(body.includeArchive), analyzeLimit };
}

function isLogEvent(e: unknown): e is MatchLogEvent {
  const x = e as MatchLogEvent;
  return Boolean(x) && typeof x.id === "string" && typeof x.kind === "string" && typeof x.wallclock === "string" && typeof x.period === "number";
}
