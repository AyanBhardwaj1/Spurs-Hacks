import { afterAll, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// Through the real ffmpeg: the extras a clip can carry (the slow-motion replay's setpts and atempo, the
// logo overlay) have to fit the graph the clip already uses, and messy sources have to read.

mock.module("server-only", () => ({}));
const dir = mkdtempSync(path.join(tmpdir(), "rundown-replay-"));
const { renderArgs, clipAss, logoPlacement } = await import("./captions");
const { coverArgs, coverAss } = await import("./cover");
const { runFfmpeg } = await import("./ffmpeg");
const { probe } = await import("./media");

afterAll(() => rmSync(dir, { recursive: true, force: true }));
const haveFfmpeg = Boolean(process.env.FFMPEG_PATH || (ffmpegStatic && existsSync(ffmpegStatic)));

test.skipIf(!haveFfmpeg)(
  "a clip with a replay runs its cut plus twice the replay, with sound and without",
  async () => {
    const source = path.join(dir, "match.mp4");
    const made = await runFfmpeg([
      "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=12", "-f", "lavfi", "-i", "sine=f=440:d=12",
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", "-y", source,
    ]);
    expect(made.code).toBe(0);
    writeFileSync(path.join(dir, "c.ass"), clipAss({ width: 360, height: 640, safeTop: 0.1, safeBottom: 0.3, hook: "", font: "Arial", captions: [], replayAt: { start: 8, end: 14 } }));
    for (const hasAudio of [true, false]) {
      const output = path.join(dir, `clip-${hasAudio}.mp4`);
      const run = await runFfmpeg(renderArgs({ source, segments: [{ start: 2, end: 10 }], replay: { start: 5, end: 8 }, width: 360, height: 640, captions: "c.ass", output, hasAudio }), { cwd: dir });
      expect(run.code, run.stderr).toBe(0);
      const out = await probe(output);
      expect(Math.abs(out.durationSec - 14)).toBeLessThan(0.3);
      expect(out.hasAudio).toBe(true);
    }
  },
  120_000,
);

test.skipIf(!haveFfmpeg)(
  "a logo goes over a clip and its cover, keeping their size",
  async () => {
    const source = path.join(dir, "plain.mp4");
    const logo = path.join(dir, "logo.png");
    expect((await runFfmpeg(["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=4", "-c:v", "libx264", "-preset", "ultrafast", "-y", source])).code).toBe(0);
    expect((await runFfmpeg(["-v", "error", "-f", "lavfi", "-i", "color=c=red@0.8:s=200x100,format=rgba", "-frames:v", "1", "-y", logo])).code).toBe(0);
    writeFileSync(path.join(dir, "l.ass"), coverAss({ width: 360, height: 640, hook: "Logo", font: "Arial" }));
    const place = { file: logo, ...logoPlacement(360, 640, 0.1) };
    const clip = path.join(dir, "logo.mp4");
    const run = await runFfmpeg(renderArgs({ source, segments: [{ start: 0, end: 3 }], width: 360, height: 640, captions: "l.ass", output: clip, hasAudio: false, logo: place }), { cwd: dir });
    expect(run.code, run.stderr).toBe(0);
    expect(await probe(clip)).toMatchObject({ width: 360, height: 640 });
    const cover = path.join(dir, "logo.jpg");
    const shot = await runFfmpeg(coverArgs({ source, at: 1, width: 360, height: 640, captions: "l.ass", output: cover, logo: place }), { cwd: dir });
    expect(shot.code, shot.stderr).toBe(0);
    expect(await probe(cover)).toMatchObject({ width: 360, height: 640 });
  },
  120_000,
);

test.skipIf(!haveFfmpeg)(
  "a WebM written as a stream, with no length in its header, is measured instead of refused",
  async () => {
    const webm = path.join(dir, "stream.webm");
    // Writing to a pipe leaves the header without a duration, as a browser or phone recording does.
    const made = Bun.spawnSync([process.env.FFMPEG_PATH || ffmpegStatic!, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=8", "-f", "lavfi", "-i", "sine=d=8", "-c:v", "libvpx", "-deadline", "realtime", "-c:a", "libopus", "-f", "webm", "pipe:1"]);
    expect(made.exitCode).toBe(0);
    writeFileSync(webm, made.stdout);
    const info = await probe(webm);
    expect(Math.abs(info.durationSec - 8)).toBeLessThan(0.2);
    expect(info).toMatchObject({ width: 320, height: 180, hasAudio: true });
  },
  120_000,
);
