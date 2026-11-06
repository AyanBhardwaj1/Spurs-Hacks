import { PLACEMENTS } from "@/lib/rundown/platforms";
import { postOrder } from "./rank";
import type { Job } from "./types";

/**
 * A job as the list of matches shows it. The cover is from the clip to post first, a wide one when there
 * is one, since the list draws 16:9 tiles.
 */
export function jobSummary(job: Job) {
  const order = postOrder(job.clips, job.moments);
  const withCover = job.clips.filter((c) => c.render.cover).sort((a, b) => (order.get(a.id)?.rank ?? 99) - (order.get(b.id)?.rank ?? 99) || (order.get(b.id)?.score ?? 0) - (order.get(a.id)?.score ?? 0));
  const cover = withCover.find((c) => PLACEMENTS[c.placement].aspect === "16:9") ?? withCover[0];
  return {
    id: job.id,
    title: job.title,
    sport: job.sport,
    status: job.status,
    createdAt: job.createdAt,
    placements: job.placements,
    durationSec: job.source?.durationSec,
    clips: job.clips.length,
    ready: job.clips.filter((c) => c.render.state === "ready").length,
    approved: job.clips.filter((c) => c.decision?.value === "approved").length,
    ...(cover && { cover: cover.id }),
  };
}

export type JobSummary = ReturnType<typeof jobSummary>;
