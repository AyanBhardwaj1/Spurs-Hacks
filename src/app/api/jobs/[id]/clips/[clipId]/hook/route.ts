import { parseHook } from "@/lib/jobs/requests";
import { enqueueRender, isActive } from "@/lib/jobs/runner";
import { getJob, updateJob } from "@/lib/jobs/store";

// A producer swaps a clip's hook, one of its options or their own words, and the clip and its cover
// render again with it. The earlier approval was for the old hook, so it is cleared. POST { hook }.

export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/clips/[clipId]/hook">) {
  const { id, clipId } = await ctx.params;
  const job = await getJob(id);
  const clip = job?.clips.find((c) => c.id === clipId);
  if (!job || !clip) return Response.json({ error: "No such clip." }, { status: 404 });
  if (isActive(id) || job.status !== "done") return Response.json({ error: "Change the hook once the job has finished." }, { status: 409 });
  const parsed = parseHook(await request.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const next = await updateJob(id, (j) => ({
    ...j,
    status: "queued",
    clips: j.clips.map((c) => (c.id === clipId ? { ...c, hook: parsed.value, decision: undefined, render: { state: "waiting" } } : c)),
  }));
  enqueueRender(id, [clipId]);
  return Response.json(next.clips.find((c) => c.id === clipId));
}
