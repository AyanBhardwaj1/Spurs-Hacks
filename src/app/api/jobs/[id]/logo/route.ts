import { rename, writeFile } from "node:fs/promises";
import { checkLogo, LOGO_MAX_BYTES } from "@/lib/jobs/requests";
import { isActive } from "@/lib/jobs/runner";
import { getJob, jobFile, saveJob, withJob } from "@/lib/jobs/store";

// PUT the club's logo, a PNG or JPEG, as the raw body. Clips rendered after it carry it in the top
// corner; re-cut a clip to add it to one rendered before.

export async function PUT(request: Request, ctx: RouteContext<"/api/jobs/[id]/logo">) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: `No job ${id}.` }, { status: 404 });
  if (job.status === "running" || isActive(id)) return Response.json({ error: "The job is rendering; add the logo when it finishes." }, { status: 409 });
  if (Number(request.headers.get("content-length") ?? 0) > LOGO_MAX_BYTES) return Response.json({ error: "Upload a logo of at most 2 MB." }, { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  const checked = checkLogo(bytes);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
  // Swapped in under the job's lock and only while nothing renders, so ffmpeg never reads a half-written logo.
  const file = jobFile.logo(id, checked.value);
  const next = await withJob(id, async () => {
    const now = await getJob(id);
    if (!now || now.status === "running" || isActive(id)) return undefined;
    await writeFile(/*turbopackIgnore: true*/ `${file}.tmp`, bytes);
    await rename(/*turbopackIgnore: true*/ `${file}.tmp`, file);
    const saved = { ...now, brand: { ...now.brand, logo: checked.value } };
    await saveJob(saved);
    return saved;
  });
  if (!next) return Response.json({ error: "The job is rendering; add the logo when it finishes." }, { status: 409 });
  return Response.json(next);
}
