import "server-only";
import { addVideoLogs, getMedia, listVideoLogs } from "@/lib/scoreplay";
import { hasRescue, RESCUE_TAG, rescueComment, rescueKey } from "./rescue-log";
import type { Rejected } from "./types";

// Writes a rescued candidate onto the match as a video log, then reads it back. ScorePlay returns no log
// IDs, so the key in the comment is how a second press finds the first one instead of writing again.

export type RescueResult = { status: "written" | "already" };

// A second request for the same key waits for the one in flight. Like the review lock, this lives in the
// server process, which is enough for the demo's single server.
const inFlight = new Map<string, Promise<RescueResult>>();

export function writeRescue(item: Pick<Rejected, "at" | "title" | "reason">, range: { start: number; end: number }, sourceId: number) {
  const key = rescueKey(sourceId, item.at);
  const running = inFlight.get(key);
  if (running) return running;
  const run = write(item, range, sourceId, key).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

async function write(item: Pick<Rejected, "title" | "reason">, range: { start: number; end: number }, sourceId: number, key: string): Promise<RescueResult> {
  // One page of 200 logs is enough here; a truncated page costs at most a duplicate log.
  if (hasRescue((await listVideoLogs(sourceId)).items, key)) return { status: "already" };
  const media = await getMedia(sourceId);
  if (!Number.isInteger(media.company_id) || media.company_id <= 0) throw new Error(`ScorePlay media ${sourceId} has no company_id for /video/logs`);
  // Offsets are seconds, as scripts/studio/writeback.ts writes them.
  const logged = await addVideoLogs(media.company_id, [
    { media_id: sourceId, start_offset: range.start, end_offset: range.end, comment: rescueComment(item, key), raw_tags: [RESCUE_TAG] },
  ]);
  if (logged !== true) throw new Error(`ScorePlay did not confirm the rescue log on media ${sourceId}`);
  if (!hasRescue((await listVideoLogs(sourceId)).items, key)) throw new Error(`the rescue log is not on media ${sourceId} after writing it`);
  return { status: "written" };
}
