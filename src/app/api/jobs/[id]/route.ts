import { isActive, recoverJobs } from "@/lib/jobs/runner";
import { deleteJob, getJob, isJobId } from "@/lib/jobs/store";

export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  // A job saved as running by a server that has since restarted is picked up again here.
  await recoverJobs();
  const job = await getJob(id);
  if (!job) return Response.json({ error: `No job ${id}.` }, { status: 404 });
  return Response.json(job);
}

/** Deletes the job, its video and its clips. A job still in line or running is refused, so a render never loses its folder. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  if (!isJobId(id)) return Response.json({ error: `No job ${id}.` }, { status: 404 });
  const job = await getJob(id);
  if (!job) return Response.json({ error: `No job ${id}.` }, { status: 404 });
  // What this server is running decides, not the saved status, which a restart can leave behind.
  await recoverJobs();
  if (isActive(id)) return Response.json({ error: "The job is still running; delete it when it finishes." }, { status: 409 });
  await deleteJob(id);
  return new Response(null, { status: 204 });
}
