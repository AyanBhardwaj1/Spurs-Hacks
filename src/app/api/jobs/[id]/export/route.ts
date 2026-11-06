import { readFile, stat } from "node:fs/promises";
import { clipSrt, exportManifest, zipStored } from "@/lib/jobs/export";
import { getJob, jobFile, jobWords } from "@/lib/jobs/store";

// Every approved, rendered clip in one zip: the videos, their SRT captions, posts.txt with each post
// ready to paste, and manifest.json for a scheduling tool. ?all=1 takes every rendered clip instead.

/** The zip is built in memory, so a job's export is capped. */
const MAX_BYTES = 1024 ** 3;

export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/export">) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: `No job ${id}.` }, { status: 404 });
  const all = new URL(request.url).searchParams.get("all") === "1";
  const clips = job.clips.filter((c) => c.render.state === "ready" && (all || c.decision?.value === "approved"));
  if (clips.length === 0) return Response.json({ error: all ? "No clip is rendered yet." : "Approve a clip first, or download every clip with ?all=1." }, { status: 404 });

  const sizes = await Promise.all(clips.map((c) => stat(/*turbopackIgnore: true*/ jobFile.clip(id, c.id)).then((s) => s.size)));
  if (sizes.reduce((n, s) => n + s, 0) > MAX_BYTES) return Response.json({ error: "Those clips are over 1 GB together; download them one at a time." }, { status: 413 });

  const enc = new TextEncoder();
  const words = await jobWords(id);
  const manifest = exportManifest(job.title, clips);
  const files: { name: string; data: Uint8Array }[] = [];
  for (const c of clips) {
    files.push({ name: `clips/${c.id}.mp4`, data: new Uint8Array(await readFile(/*turbopackIgnore: true*/ jobFile.clip(id, c.id))) });
    const srt = clipSrt(words, c.segments);
    if (srt) files.push({ name: `captions/${c.id}.srt`, data: enc.encode(srt) });
  }
  files.push({ name: "posts.txt", data: enc.encode(manifest.clips.map((c) => `${c.platform} ${c.placement} · ${c.file}\n${c.post}\n`).join("\n")) });
  files.push({ name: "manifest.json", data: enc.encode(JSON.stringify(manifest, null, 2)) });

  const slug = job.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "rundown";
  return new Response(zipStored(files), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${slug}-clips.zip"` },
  });
}
