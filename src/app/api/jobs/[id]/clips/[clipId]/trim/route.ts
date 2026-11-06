import { parseTrim } from "@/lib/jobs/requests";
import { enqueueRender, isActive } from "@/lib/jobs/runner";
import { getJob, updateJob } from "@/lib/jobs/store";

// A producer moves a clip's edges and it renders again. The earlier approval was for the old cut, so it
// is cleared. POST { start, end } in source seconds.

export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/clips/[clipId]/trim">) {
  const { id, clipId } = await ctx.params;
  const job = await getJob(id);
  const clip = job?.clips.find((c) => c.id === clipId);
  if (!job || !clip || !job.source) return Response.json({ error: "No such clip." }, { status: 404 });
  if (isActive(id)) return Response.json({ error: "The job is still running; trim the clip when it finishes." }, { status: 409 });
  const parsed = parseTrim(await request.json().catch(() => null), clip, job.source.durationSec);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const next = await updateJob(id, (j) => ({
    ...j,
    status: "queued",
    clips: j.clips.map((c) => (c.id === clipId ? { ...c, segments: parsed.value, decision: undefined, render: { state: "waiting" } } : c)),
  }));
  enqueueRender(id, [clipId]);
  return Response.json(next.clips.find((c) => c.id === clipId));
}
