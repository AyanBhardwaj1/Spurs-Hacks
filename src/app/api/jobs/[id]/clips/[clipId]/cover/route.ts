import { fileResponse } from "@/lib/jobs/serve";
import { getJob, jobFile } from "@/lib/jobs/store";

/** The clip's cover image; ?download=1 saves it. */
export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/clips/[clipId]/cover">) {
  const { id, clipId } = await ctx.params;
  const job = await getJob(id);
  const clip = job?.clips.find((c) => c.id === clipId);
  if (!job || !clip?.render.cover) return Response.json({ error: "This clip has no cover." }, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1" ? `${clip.id}-cover.jpg` : undefined;
  return fileResponse(jobFile.cover(id, clip.id), request, { download, type: "image/jpeg" });
}
