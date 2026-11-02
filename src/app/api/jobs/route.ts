import { connection } from "next/server";
import { CHUNK_BYTES, parseNewJob } from "@/lib/jobs/requests";
import { createJob, listJobs } from "@/lib/jobs/store";

// GET lists the jobs on this server, newest first. POST starts one: the browser then sends the video in
// CHUNK_BYTES pieces to /api/jobs/{id}/upload.
//
// POST { title, sport, placements, fileName, size }

export async function GET() {
  await connection();
  const jobs = await listJobs();
  return Response.json(
    jobs.map((j) => ({ id: j.id, title: j.title, sport: j.sport, status: j.status, createdAt: j.createdAt, clips: j.clips.length, placements: j.placements })),
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = parseNewJob(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const job = await createJob(parsed.value);
  return Response.json({ job, chunkBytes: CHUNK_BYTES }, { status: 201 });
}
