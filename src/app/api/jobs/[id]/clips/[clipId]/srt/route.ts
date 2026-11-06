import { clipSrt } from "@/lib/jobs/export";
import { getJob, jobWords } from "@/lib/jobs/store";

/** The clip's captions as an SRT file, for platforms that take a captions upload. */
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/clips/[clipId]/srt">) {
  const { id, clipId } = await ctx.params;
  const job = await getJob(id);
  const clip = job?.clips.find((c) => c.id === clipId);
  if (!job || !clip) return Response.json({ error: "No such clip." }, { status: 404 });
  const srt = clipSrt(await jobWords(id), clip.segments);
  if (!srt) return Response.json({ error: "This job has no transcript, so there are no captions." }, { status: 404 });
  return new Response(srt, { headers: { "Content-Type": "application/x-subrip; charset=utf-8", "Content-Disposition": `attachment; filename="${clip.id}.srt"` } });
}
