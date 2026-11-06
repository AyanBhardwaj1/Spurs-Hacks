// Runs a Rundown job from the command line, with no server and no browser:
//
//   bun run rundown match.mp4 --sport tennis --platforms tiktok,x-video --replay
//
// The job is kept under RUNDOWN_DATA_DIR (default .rundown) like any upload, so the studio lists it and it
// can be re-cut there. Every rendered clip, its cover and captions, posts.txt and manifest.json are
// copied to --out. OPENAI_API_KEY in the environment is used the same way the server uses it.

import { plugin } from "bun";

// The engine's modules import "server-only", which Next resolves itself; here it is a no-op.
plugin({
  name: "server-only",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
  },
});

const { copyFile, link, mkdir, readFile, stat, writeFile } = await import("node:fs/promises");
const path = await import("node:path");
const { parseCli } = await import("@/lib/jobs/cli");
const { checkLogo } = await import("@/lib/jobs/requests");
const { adoptSource, createJob, getJob, jobFile, jobWords, updateJob } = await import("@/lib/jobs/store");
const { runJob } = await import("@/lib/jobs/runner");
const { clipSrt, exportManifest } = await import("@/lib/jobs/export");
const { postOrder } = await import("@/lib/jobs/rank");
const { PLACEMENT_LABEL } = await import("@/lib/jobs/types");

const parsed = parseCli(process.argv.slice(2));
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}
const opts = parsed.value;

const size = await stat(opts.video).then(
  (s) => s.size,
  () => {
    console.error(`Cannot read ${opts.video}.`);
    process.exit(1);
  },
);
let logo: { bytes: Uint8Array; type: "png" | "jpg" } | undefined;
if (opts.logo) {
  const bytes = new Uint8Array(await readFile(opts.logo));
  const checked = checkLogo(bytes);
  if (!checked.ok) {
    console.error(checked.error);
    process.exit(1);
  }
  logo = { bytes, type: checked.value };
}

const job = await createJob({ title: opts.title, sport: opts.sport, placements: opts.placements, fileName: path.basename(opts.video), size, replay: opts.replay, colour: opts.colour, language: opts.language });
const source = jobFile.source(job.id, job.upload.fileName);
// A hard link costs no space; across volumes the video is copied instead.
await link(path.resolve(opts.video), source).catch(() => copyFile(opts.video, source));
if (logo) {
  await writeFile(jobFile.logo(job.id, logo.type), logo.bytes);
  await updateJob(job.id, (j) => ({ ...j, brand: { ...j.brand, logo: logo.type } }));
}
// A studio server sharing this data folder leaves the job to this process while it runs.
await updateJob(job.id, (j) => ({ ...j, owner: { pid: process.pid } }));
await adoptSource(job.id, size, `Read ${opts.video} from disk`);
console.log(`Job ${job.id}: ${opts.title}, ${opts.sport}, for ${opts.placements.map((p) => PLACEMENT_LABEL[p]).join(", ")}`);

// Print each stage as it finishes, from the job file the runner keeps up to date.
const printed = new Set<string>();
const report = async () => {
  const now = await getJob(job.id);
  for (const s of now?.stages ?? []) {
    if (printed.has(s.id) || !["done", "skipped", "failed"].includes(s.state)) continue;
    printed.add(s.id);
    const mark = s.state === "done" ? "✓" : s.state === "skipped" ? "–" : "✗";
    console.log(`  ${mark} ${s.label}${s.detail ? `: ${s.detail}` : ""}`);
  }
};
const ticker = setInterval(() => void report(), 1000);
await runJob(job.id).catch(() => undefined);
clearInterval(ticker);
await updateJob(job.id, (j) => ({ ...j, owner: undefined }));
await report();

const done = await getJob(job.id);
if (!done || done.status !== "done") {
  console.error(`The job stopped: ${done?.error ?? "see the stage marked ✗ above."}`);
  process.exit(1);
}

const ready = done.clips.filter((c) => c.render.state === "ready");
await mkdir(path.join(opts.out, "clips"), { recursive: true });
const words = await jobWords(job.id);
for (const c of ready) {
  await copyFile(jobFile.clip(job.id, c.id), path.join(opts.out, "clips", `${c.id}.mp4`));
  if (c.render.cover) await copyFile(jobFile.cover(job.id, c.id), path.join(opts.out, "clips", `${c.id}.jpg`));
  const srt = clipSrt(words, c.segments);
  if (srt) await writeFile(path.join(opts.out, "clips", `${c.id}.srt`), srt);
}
const manifest = exportManifest(done.title, ready, done.moments);
await writeFile(path.join(opts.out, "manifest.json"), JSON.stringify(manifest, null, 2));
await writeFile(path.join(opts.out, "posts.txt"), manifest.clips.map((c) => `${c.platform} ${c.placement} · ${c.file}\n${c.post}\n`).join("\n"));

const order = postOrder(ready, done.moments);
console.log(`\n${ready.length} of ${done.clips.length} clips rendered to ${opts.out}/. Post first:`);
for (const p of done.placements) {
  const first = ready.find((c) => c.placement === p && order.get(c.id)?.rank === 1);
  if (first) console.log(`  ${PLACEMENT_LABEL[p].padEnd(20)} ${first.id}.mp4  "${first.hook}"`);
}
console.log(`\nOpen /studio/jobs/${job.id} in the studio to review, trim or add platforms.`);
