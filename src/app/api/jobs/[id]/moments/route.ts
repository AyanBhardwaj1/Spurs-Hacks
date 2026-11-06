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
  const parsed = parsePick(await request.json().catch(() => null), job.source.durationSec);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const placements = job.placements.filter((p) => !isMontage(p));
  if (placements.length === 0) return Response.json({ error: "This job only has montage cuts; add a short platform first." }, { status: 409 });

  const moment = pickedMoment(parsed.value, await jobWords(id), job.source.durationSec, new Set(job.moments.map((m) => m.id)));
  const { clips } = planClips({ moments: [moment], placements, durationSec: job.source.durationSec, sport: job.sport, title: job.title, replay: job.replay });
  const next = await updateJob(id, (j) => ({ ...j, status: "queued", moments: [...j.moments, moment], clips: [...j.clips, ...clips] }));
  enqueueRender(id, clips.map((c) => c.id), { writeCopy: true });
  return Response.json(next, { status: 201 });
}
