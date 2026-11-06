import { rm } from "node:fs/promises";
import { isActive } from "@/lib/jobs/runner";
import { getJob, jobFile, updateJob, withJob } from "@/lib/jobs/store";

// DELETE drops a finished job's match video and keeps its clips, covers and posts: the video is most of
// the space a job takes. Anything that cuts the match again (trim, hooks, new platforms, picked moments)
// is refused afterwards.

export async function DELETE(_request: Request, ctx: RouteContext<"/api/jobs/[id]/source">) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: `No job ${id}.` }, { status: 404 });
  if (job.status !== "done" || isActive(id)) return Response.json({ error: "Delete the video once the job has finished." }, { status: 409 });
  const freed = await withJob(id, async () => {
    await rm(/*turbopackIgnore: true*/ jobFile.source(id, job.upload.fileName), { force: true });
    return job.upload.size;
  });
  const next = await updateJob(id, (j) => ({ ...j, sourceDeleted: true }));
  return Response.json({ job: next, freedBytes: freed });
}
