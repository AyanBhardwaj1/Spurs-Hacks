import { fileResponse } from "@/lib/jobs/serve";
import { getJob, jobFile, updateJob } from "@/lib/jobs/store";
import type { ClipDecision } from "@/lib/jobs/types";

// GET plays a rendered clip, with ranges for seeking; ?download=1 saves it under a readable name.
// POST records a producer's decision: { decision: "approved" | "rejected" | null, reason? }.

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "clip";

export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/clips/[clipId]">) {
  const { id, clipId } = await ctx.params;
  const job = await getJob(id);
  const clip = job?.clips.find((c) => c.id === clipId);
  if (!job || !clip) return Response.json({ error: "No such clip." }, { status: 404 });
  if (clip.render.state !== "ready") return Response.json({ error: "The clip is not rendered yet." }, { status: 409 });
  const download = new URL(request.url).searchParams.get("download") === "1" ? `${slug(job.title)}-${clip.id}.mp4` : undefined;
  return fileResponse(jobFile.clip(id, clip.id), request, { download });
}

export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/clips/[clipId]">) {
  const { id, clipId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { decision?: unknown; reason?: unknown } | null;
  const decision = body?.decision;
  if (decision !== "approved" && decision !== "rejected" && decision !== null) {
    return Response.json({ error: 'decision must be "approved", "rejected" or null.' }, { status: 400 });
  }
  const reason = body?.reason;
  if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) return Response.json({ error: "reason must be text of at most 500 characters." }, { status: 400 });
  const job = await getJob(id);
  if (!job?.clips.some((c) => c.id === clipId)) return Response.json({ error: "No such clip." }, { status: 404 });
  const next = await updateJob(id, (j) => ({
    ...j,
    clips: j.clips.map((c) =>
      c.id !== clipId ? c : { ...c, decision: decision === null ? undefined : { value: decision as ClipDecision, reason: (reason as string | undefined)?.trim() || undefined, at: new Date().toISOString() } },
    ),
  }));
  return Response.json(next.clips.find((c) => c.id === clipId));
}
