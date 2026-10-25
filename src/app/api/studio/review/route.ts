import { scoreplayConfigured } from "@/lib/scoreplay";
import { loadStudioAnalysis } from "@/lib/studio/load";
import { writeReview, type Decision } from "@/lib/studio/review";
import { ServiceTimeout, WRITE_TIMEOUT_MS, within } from "@/lib/studio/slow";

// A producer approves, rejects or clears the decision on one planned clip. The decision is written onto
// the clip's uploaded ScorePlay media, and the response is what ScorePlay holds afterwards. Only media
// uploaded for this analysis's clips can be touched.
//
// POST { mediaId: number, decision: "approved" | "rejected" | null, reason?: string }

// Writes to one media item run one at a time: each reads the tags, changes them and reads them back, so two
// interleaved writes could leave both decision tags on. This lock lives in the server process, which is
// enough for the demo's single server; more than one instance would need a shared lock.
const queues = new Map<number, Promise<unknown>>();

function oneAtATime<T>(mediaId: number, write: () => Promise<T>): Promise<T> {
  const before = queues.get(mediaId) ?? Promise.resolve();
  const run = before.then(write, write);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(mediaId, settled);
  void settled.then(() => {
    if (queues.get(mediaId) === settled) queues.delete(mediaId);
  });
  return run;
}

export async function POST(request: Request) {
  if (!scoreplayConfigured()) return Response.json({ error: "No ScorePlay key on the server, so nothing was written." }, { status: 503 });

  let body: { mediaId?: unknown; decision?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The request body is not JSON." }, { status: 400 });
  }
  const { mediaId, decision, reason } = body;
  if (typeof mediaId !== "number") return Response.json({ error: "mediaId must be a ScorePlay media ID." }, { status: 400 });
  if (decision !== "approved" && decision !== "rejected" && decision !== null) {
    return Response.json({ error: 'decision must be "approved", "rejected" or null.' }, { status: 400 });
  }
  if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
    return Response.json({ error: "reason must be text of at most 500 characters." }, { status: 400 });
  }
  const ours = loadStudioAnalysis().clips.some((c) => c.scoreplayMediaId === mediaId);
  if (!ours) return Response.json({ error: `ScorePlay media ${mediaId} is not a clip from this analysis.` }, { status: 404 });

  try {
    const review = await within(
      oneAtATime(mediaId, () => writeReview(mediaId, decision as Decision | null, (reason as string | undefined)?.trim() || undefined)),
      WRITE_TIMEOUT_MS,
      "the decision",
    );
    return Response.json(review);
  } catch (err) {
    if (err instanceof ServiceTimeout) {
      return Response.json(
        { error: `${err.message}. The decision may still land; reload to see what ScorePlay holds.` },
        { status: 504 },
      );
    }
    return Response.json({ error: `ScorePlay refused the change: ${(err as Error).message}` }, { status: 502 });
  }
}
