import { scoreplayConfigured } from "@/lib/scoreplay";
import { loadStudioAnalysis } from "@/lib/studio/load";
import { writeRescue } from "@/lib/studio/rescue";
import { findRejected, rescueRange } from "@/lib/studio/rescue-log";
import { ServiceTimeout, WRITE_TIMEOUT_MS, within } from "@/lib/studio/slow";

// A producer rescues a candidate the run dropped. The rescue is written onto the full match in ScorePlay as
// a timecoded log tagged rundown-rescued, for the edit team to cut. Only candidates in this analysis's
// dropped list can be written.
//
// POST { at: number, title: string }

export async function POST(request: Request) {
  if (!scoreplayConfigured()) return Response.json({ error: "No ScorePlay key on the server, so nothing was written." }, { status: 503 });

  let body: { at?: unknown; title?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The request body is not JSON." }, { status: 400 });
  }
  const { at, title } = body;
  if (typeof at !== "number" || typeof title !== "string") {
    return Response.json({ error: "at must be a source second and title the candidate's title." }, { status: 400 });
  }
  const analysis = loadStudioAnalysis();
  const item = findRejected(analysis.rejected, at, title);
  if (!item) return Response.json({ error: "That candidate is not in this analysis's dropped list." }, { status: 404 });
  const moment = item.momentId ? analysis.moments.find((m) => m.id === item.momentId) : undefined;
  const range = rescueRange(item, moment, analysis.source.durationSec);

  try {
    const { status } = await within(writeRescue(item, range, analysis.source.id), WRITE_TIMEOUT_MS, "the rescue");
    return Response.json({ status, mediaId: analysis.source.id, ...range });
  } catch (err) {
    if (err instanceof ServiceTimeout) {
      return Response.json(
        { error: `${err.message}. The rescue may still land; reload and press again to see what ScorePlay holds.` },
        { status: 504 },
      );
    }
    return Response.json({ error: `ScorePlay refused the rescue: ${(err as Error).message}` }, { status: 502 });
  }
}
