import { writeFile } from "node:fs/promises";
import { checkLogo, LOGO_MAX_BYTES } from "@/lib/jobs/requests";
import { isActive } from "@/lib/jobs/runner";
import { getJob, jobFile, updateJob } from "@/lib/jobs/store";

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
  await writeFile(/*turbopackIgnore: true*/ jobFile.logo(id, checked.value), bytes);
  const next = await updateJob(id, (j) => ({ ...j, brand: { ...j.brand, logo: checked.value } }));
  return Response.json(next);
}
