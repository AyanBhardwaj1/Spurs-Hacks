import { stat } from "node:fs/promises";
import { lastLine, runFfmpeg } from "@/lib/jobs/ffmpeg";
import { enqueue } from "@/lib/jobs/runner";
import { SAMPLE, sampleMatchArgs } from "@/lib/jobs/sample";
import { adoptSource, createJob, jobFile } from "@/lib/jobs/store";
import { JOB_PLACEMENTS } from "@/lib/jobs/types";

// Starts a job on a synthetic match generated here, for trying Rundown without a video of your own.
// POST, no body. Answers with the job, which then runs like any upload.

export async function POST() {
  const job = await createJob({ title: SAMPLE.title, sport: "soccer", placements: [...JOB_PLACEMENTS], fileName: "sample.mp4", size: 1 });
  const source = jobFile.source(job.id, "sample.mp4");
  const made = await runFfmpeg(sampleMatchArgs(source), { timeoutMs: 120_000 });
  if (made.code !== 0) return Response.json({ error: `Could not make the sample match: ${lastLine(made.stderr)}` }, { status: 500 });
  const ready = await adoptSource(job.id, (await stat(/*turbopackIgnore: true*/ source)).size, "Generated a 3-minute sample match on the server");
  enqueue(job.id);
  return Response.json({ job: ready }, { status: 201 });
}
