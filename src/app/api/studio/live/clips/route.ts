import { connection } from "next/server";
import { getMedia, scoreplayConfigured } from "@/lib/scoreplay";
import type { MediaWithVideo } from "@/lib/studio/library";
import type { LiveClipStreams } from "@/lib/studio/live";
import { sharedInFlight } from "@/lib/studio/live-work";
import { loadStudioAnalysis } from "@/lib/studio/load";
import { READ_TIMEOUT_MS } from "@/lib/studio/slow";

// Where to stream each uploaded ASAP clip from: ScorePlay's rendition of the file the pipeline uploaded.
// The live page asks once on load. The URLs need the server's ScorePlay key to look up, so the browser
// cannot ask ScorePlay itself. Each clip is looked up on its own: a lookup is cancelled at
// READ_TIMEOUT_MS, shared with any request already making it, and its answer kept for a while, so one
// slow clip neither holds up nor throws away the others.

type Stream = LiveClipStreams[number];

/** A found rendition does not change; a failure is retried soon, in case ScorePlay was only slow. */
const FOUND_TTL_MS = 10 * 60_000;
const FAILED_TTL_MS = 30_000;

const answers = new Map<number, { at: number; stream?: Stream }>();
const lookup = sharedInFlight<number, Stream | undefined>();

async function stream(id: number): Promise<Stream | undefined> {
  const kept = answers.get(id);
  if (kept && Date.now() - kept.at < (kept.stream ? FOUND_TTL_MS : FAILED_TTL_MS)) return kept.stream;
  return lookup(id, async () => {
    let found: Stream | undefined;
    try {
      const m = (await getMedia(id, AbortSignal.timeout(READ_TIMEOUT_MS))) as MediaWithVideo;
      const url = m.video?.proxy_medium ?? m.proxy_medium;
      if (!url) throw new Error(`ScorePlay media ${id} has no playable rendition yet`);
      found = { url, thumbnailUrl: m.video?.thumbnail ?? m.thumbnail_url };
    } catch (err) {
      console.warn(`[studio live] clip ${id}: ${(err as Error).message}`);
    }
    answers.set(id, { at: Date.now(), stream: found });
    return found;
  });
}

export async function GET() {
  // The key is read at request time; without this the build would prerender a missing-key answer.
  await connection();
  if (!scoreplayConfigured()) return Response.json({ error: "No ScorePlay key on the server." }, { status: 503 });
  const ids = loadStudioAnalysis().clips.flatMap((c) => (c.lane === "asap" && c.scoreplayMediaId ? [c.scoreplayMediaId] : []));
  const found = await Promise.all(ids.map(async (id) => [id, await stream(id)] as const));
  const streams: LiveClipStreams = {};
  for (const [id, s] of found) if (s) streams[id] = s;
  return Response.json(streams);
}
