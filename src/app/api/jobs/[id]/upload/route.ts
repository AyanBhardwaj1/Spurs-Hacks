import { CHUNK_BYTES, checkChunk } from "@/lib/jobs/requests";
import { enqueue } from "@/lib/jobs/runner";
import { appendChunk, getJob, withJob } from "@/lib/jobs/store";

// One piece of a job's video. The piece must start where the upload left off; a 409 answers with
// `received`, so the browser resumes from there after a dropped connection. The last piece queues the job.
//
// PUT ?offset=<bytes already sent>, body: the piece's bytes

export async function PUT(request: Request, ctx: RouteContext<"/api/jobs/[id]/upload">) {
  const { id } = await ctx.params;
  const offset = Number(new URL(request.url).searchParams.get("offset"));
  if (!Number.isInteger(offset) || offset < 0) return Response.json({ error: "offset must be the bytes already sent." }, { status: 400 });
  if (Number(request.headers.get("content-length") ?? 0) > CHUNK_BYTES) return Response.json({ error: `Send chunks of at most ${CHUNK_BYTES} bytes.` }, { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());

  return withJob(id, async () => {
    const job = await getJob(id);
    if (!job) return Response.json({ error: `No job ${id}.` }, { status: 404 });
    if (job.status !== "uploading") return Response.json({ error: "This job's upload is already complete.", received: job.upload.received }, { status: 409 });
    const check = checkChunk(job.upload, offset, bytes.byteLength);
    if (!check.ok) return Response.json({ error: check.error ?? "Resume from the byte the server has.", received: check.received }, { status: check.status });
    const next = await appendChunk(job, bytes);
    if (next.status === "queued") enqueue(id);
    return Response.json({ received: next.upload.received, status: next.status });
  });
}
