import { PLACEMENTS } from "@/lib/rundown/platforms";
import { clipSeconds } from "./planner";
import { postText } from "./post";
import { postOrder } from "./rank";
import type { Job } from "./types";

// With RUNDOWN_WEBHOOK_URL set, the server posts this when a job (or a re-render of some of its clips)
// finishes or fails, so a chat, a scheduler or an automation tool can pick the clips up. The links point
// back at this server, under RUNDOWN_PUBLIC_URL, and need its password like any other page.

export function webhookPayload(job: Job, baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  const order = postOrder(job.clips, job.moments);
  const ready = job.clips.filter((c) => c.render.state === "ready");
  return {
    event: job.status === "failed" ? "job.failed" : "job.done",
    ...(job.error && { error: job.error }),
    job: { id: job.id, title: job.title, sport: job.sport, status: job.status, url: `${base}/studio/jobs/${job.id}`, clips: job.clips.length, ready: ready.length },
    clips: ready.map((c) => ({
      id: c.id,
      platform: PLACEMENTS[c.placement].platform,
      placement: PLACEMENTS[c.placement].placement,
      order: order.get(c.id)?.rank,
      seconds: Math.round(clipSeconds(c)),
      hook: c.hook,
      post: postText(c),
      video: `${base}/api/jobs/${job.id}/clips/${c.id}?download=1`,
      ...(c.render.cover && { cover: `${base}/api/jobs/${job.id}/clips/${c.id}/cover` }),
    })),
  };
}

/** Posts the job to the webhook, once, within ten seconds. A failure is logged, never the job's. */
export async function notifyWebhook(job: Job) {
  const url = process.env.RUNDOWN_WEBHOOK_URL;
  if (!url) return;
  const base = process.env.RUNDOWN_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(webhookPayload(job, base)), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) console.warn(`[jobs] ${job.id} webhook answered ${res.status}`);
  } catch (err) {
    console.warn(`[jobs] ${job.id} webhook failed:`, err);
  }
}
