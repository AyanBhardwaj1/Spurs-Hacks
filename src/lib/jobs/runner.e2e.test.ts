import { afterAll, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// The whole pipeline on a synthetic match: 90 s of test pattern with pink "crowd" noise that roars at
// 30 s and 65 s. No club footage, no API keys: it proves the engine finds the roars, plans per platform
// and renders files of each platform's size with the ffmpeg the repo ships.

mock.module("server-only", () => ({}));
const dir = mkdtempSync(path.join(tmpdir(), "rundown-e2e-"));
process.env.RUNDOWN_DATA_DIR = dir;
delete process.env.OPENAI_API_KEY;
const { appendChunk, createJob, getJob, jobFile } = await import("./store");
const { runJob } = await import("./runner");
const { probe } = await import("./media");
const { runFfmpeg } = await import("./ffmpeg");

afterAll(() => rmSync(dir, { recursive: true, force: true }));
const haveFfmpeg = Boolean(process.env.FFMPEG_PATH || (ffmpegStatic && existsSync(ffmpegStatic)));

test.skipIf(!haveFfmpeg)(
  "a synthetic match goes from upload to rendered clips for each platform",
  async () => {
    const match = path.join(dir, "match.mp4");
    const made = await runFfmpeg([
      "-v", "error",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=90",
      "-f", "lavfi", "-i", "anoisesrc=d=90:c=pink:a=0.04",
      "-filter_complex", "[1:a]volume='if(between(t,30,36)+between(t,65,71),8,1)':eval=frame[a]",
      "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", "-y", match,
    ]);
    expect(made.code).toBe(0);

    const bytes = new Uint8Array(await readFile(match));
    let job = await createJob({ title: "Synthetic FC v Test United", sport: "soccer", placements: ["tiktok", "x-video"], fileName: "match.mp4", size: bytes.byteLength });
    job = await appendChunk(job, bytes);
    expect(job.status).toBe("queued");

    await runJob(job.id);
    job = (await getJob(job.id))!;
    expect(job.status).toBe("done");
    expect(job.stages.find((s) => s.id === "transcript")!.state).toBe("skipped");

    const peaks = job.moments.filter((m) => m.signals.includes("crowd")).map((m) => m.peak).sort((a, b) => a - b);
    expect(peaks.some((p) => Math.abs(p - 30) <= 2)).toBe(true);
    expect(peaks.some((p) => Math.abs(p - 65) <= 2)).toBe(true);

    expect(job.clips.length).toBeGreaterThanOrEqual(4);
    for (const clip of job.clips) {
      expect(clip.render.state).toBe("ready");
      const out = await probe(jobFile.clip(job.id, clip.id));
      const expected = clip.placement === "tiktok" ? [1080, 1920] : [1280, 720];
      expect([out.width, out.height]).toEqual(expected);
      expect(out.hasAudio).toBe(true);
      // ffmpeg reads a JPEG's size the same way it reads a video's.
      expect(clip.render.cover).toBe(`${clip.id}.jpg`);
      expect(clip.render.probe).toMatchObject({ width: expected[0], height: expected[1], hasAudio: true });
      const cover = await probe(jobFile.cover(job.id, clip.id));
      expect([cover.width, cover.height]).toEqual(expected);
    }
    expect(existsSync(jobFile.work(job.id))).toBe(false);
  },
  240_000,
);
