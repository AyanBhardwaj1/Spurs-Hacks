import { planClips } from "@/lib/jobs/planner";
import { parseAddPlacements } from "@/lib/jobs/requests";
import { enqueueRender, isActive } from "@/lib/jobs/runner";
import { getJob, updateJob } from "@/lib/jobs/store";

// Cuts a finished job for platforms it was not first cut for, from the moments it already found.
// POST { placements: [...] }

export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/placements">) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job || !job.source) return Response.json({ error: `No finished job ${id}.` }, { status: 404 });
  if (isActive(id) || job.status !== "done") return Response.json({ error: "Add platforms once the job has finished." }, { status: 409 });
  if (job.sourceDeleted) return Response.json({ error: "The match video was deleted, so it cannot be cut again." }, { status: 409 });
  const parsed = parseAddPlacements(await request.json().catch(() => null), job.placements);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { clips, skipped } = planClips({ moments: job.moments, placements: parsed.value, durationSec: job.source.durationSec, sport: job.sport, title: job.title, replay: job.replay });
  const next = await updateJob(id, (j) => ({
    ...j,
    status: "queued",
    placements: [...j.placements, ...parsed.value],
    clips: [...j.clips, ...clips],
    skipped: [...j.skipped, ...skipped],
  }));
  if (clips.length > 0) enqueueRender(id, clips.map((c) => c.id), { writeCopy: true });
  else await updateJob(id, (j) => ({ ...j, status: "done" }));
  return Response.json(next);
}
