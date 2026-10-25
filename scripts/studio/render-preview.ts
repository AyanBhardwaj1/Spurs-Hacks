// Renders chosen clips with their graphics into scripts/studio/out for review,
// without touching publish.json or uploading anything. The files are
// temporary: delete them once reviewed.
//   FFMPEG_PATH=… bun scripts/studio/render-preview.ts <clip id> [<clip id> …]
import { mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { graphicsJob } from "./graphics-job";
import { ffmpegArgs } from "./render";
import { renderSource } from "./render-source";
import { rundownRender } from "./server-modules";
import { assertAnalysis } from "./validate";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const ANALYSIS = join(import.meta.dir, "..", "..", "src", "lib", "studio", "data", "mnu-tot.json");
const OUT_DIR = join(import.meta.dir, "out");

const ids = process.argv.slice(2);
if (ids.length === 0) throw new Error("Name at least one clip ID");
const analysis: unknown = JSON.parse(readFileSync(ANALYSIS, "utf8"));
assertAnalysis(analysis);
const fontFile = rundownRender.defaultFont();
if (!fontFile) throw new Error("No bold font found; set RUNDOWN_FONT");
const focus = new Map(analysis.moments.map((m) => [m.id, m.focus]));
const job = graphicsJob(analysis, FFMPEG);
const source = await renderSource(analysis.source.id);
mkdirSync(OUT_DIR, { recursive: true });

try {
  for (const id of ids) {
    const clip = analysis.clips.find((c) => c.id === id);
    if (!clip) throw new Error(`No clip ${id} in the analysis`);
    const prepared = performance.now();
    const graphics = await job.forClip(clip, source.url);
    const prepareSec = (performance.now() - prepared) / 1000;
    const temporary = join(OUT_DIR, `${id}.rendering.mp4`);
    const args = ffmpegArgs({ clip, url: source.url, focus, fontFile, escape: rundownRender.escapeDrawtext, wrap: rundownRender.wrapHook, graphics }, temporary);
    const started = performance.now();
    const file = join(OUT_DIR, `${id}.mp4`);
    try {
      const proc = Bun.spawn([FFMPEG, ...args], { stdout: "ignore", stderr: "pipe" });
      const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
      if (code !== 0) throw new Error(`ffmpeg exited ${code} rendering ${id}: ${stderr.replaceAll(source.url, "[source URL]").trim().split("\n").slice(-4).join(" | ")}`);
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
    console.log(`${id}: ${(statSync(file).size / 1e6).toFixed(1)} MB; word timing ${prepareSec.toFixed(1)} s, ffmpeg ${((performance.now() - started) / 1000).toFixed(1)} s -> ${file}`);
  }
} finally {
  job.dispose();
}
