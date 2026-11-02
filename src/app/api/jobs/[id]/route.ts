import { deleteJob, getJob, isJobId } from "@/lib/jobs/store";

export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: `No job ${id}.` }, { status: 404 });
  return Response.json(job);
}

/** Deletes the job, its video and its clips. A job still running is refused, so a render never loses its folder. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  if (!isJobId(id)) return Response.json({ error: `No job ${id}.` }, { status: 404 });
  const job = await getJob(id);
  if (!job) return Response.json({ error: `No job ${id}.` }, { status: 404 });
  if (job.status === "running" || job.status === "queued") return Response.json({ error: "The job is still running; delete it when it finishes." }, { status: 409 });
  await deleteJob(id);
  return new Response(null, { status: 204 });
}
