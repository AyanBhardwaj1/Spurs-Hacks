import { pickedMoment } from "@/lib/jobs/moments";
import { isMontage, planClips } from "@/lib/jobs/planner";
import { parsePick } from "@/lib/jobs/requests";
import { enqueueRender, isActive } from "@/lib/jobs/runner";
import { getJob, jobWords, updateJob } from "@/lib/jobs/store";

// A producer points at a second the rules missed, and it becomes a moment with a clip for every short
// platform the job is cut for. The highlights cut and the recap keep their own picks. POST { at } in source seconds.

export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/moments">) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job || !job.source) return Response.json({ error: `No finished job ${id}.` }, { status: 404 });
  if (isActive(id) || job.status !== "done") return Response.json({ error: "Pick a moment once the job has finished." }, { status: 409 });
  if (job.sourceDeleted) return Response.json({ error: "The match video was deleted, so it cannot be cut again." }, { status: 409 });
  const parsed = parsePick(await request.json().catch(() => null), job.source.durationSec);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const placements = job.placements.filter((p) => !isMontage(p));
  if (placements.length === 0) return Response.json({ error: "This job only has montage cuts; add a short platform first." }, { status: 409 });

  const words = await jobWords(id);
  // The moment's id is chosen under the job's lock, from the moments as they are then, so two picks at
  // once cannot both take it; a job that started rendering meanwhile refuses the second.
  let clipIds: string[] = [];
  const next = await updateJob(id, (j) => {
    if (j.status !== "done" || !j.source) return j;
    const moment = pickedMoment(parsed.value, words, j.source.durationSec, new Set(j.moments.map((m) => m.id)));
    const { clips } = planClips({ moments: [moment], placements, durationSec: j.source.durationSec, sport: j.sport, title: j.title, replay: j.replay });
    clipIds = clips.map((c) => c.id);
    return { ...j, status: "queued", moments: [...j.moments, moment], clips: [...j.clips, ...clips] };
  });
  if (clipIds.length === 0) return Response.json({ error: "Pick a moment once the job has finished." }, { status: 409 });
  enqueueRender(id, clipIds, { writeCopy: true });
  return Response.json(next, { status: 201 });
}
