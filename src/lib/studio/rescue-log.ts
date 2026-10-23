import type { Moment, Rejected } from "./types";

// A rescue is a timecoded log on the full match in ScorePlay, for a candidate the run dropped and a producer
// wants cut anyway. The key in the comment lets a retry find a log whose response was lost.

export const RESCUE_TAG = "rundown-rescued";

export const rescueKey = (sourceId: number, at: number) => `rundown-rescue:${sourceId}:${at.toFixed(1)}`;

/** The ranked moment's own range, else 5 s before to 10 s after the candidate, inside the source. */
export function rescueRange(item: Pick<Rejected, "at">, moment: Pick<Moment, "start" | "end"> | undefined, durationSec: number) {
  return moment ? { start: moment.start, end: moment.end } : { start: Math.max(0, item.at - 5), end: Math.min(durationSec, item.at + 10) };
}

export const rescueComment = (item: Pick<Rejected, "title" | "reason">, key: string) =>
  `Rescued in Rundown from the dropped list: ${item.title}\nDropped because: ${item.reason.slice(0, 300)}\n[${key}]`;

export const hasRescue = (logs: { comment?: string }[], key: string) => logs.some((l) => l.comment?.includes(`[${key}]`) ?? false);

export const findRejected = (rejected: Rejected[], at: number, title: string) => rejected.find((r) => r.at === at && r.title === title);
