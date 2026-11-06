import { afterAll, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// The extras a clip can carry, through the real ffmpeg: the slow-motion replay's filters (setpts, atempo)
// and the logo overlay have to fit the graph the clip already uses, with sound and without.

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
      expect(run.stderr).toBe("");
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
    expect(run.stderr).toBe("");
    expect(await probe(clip)).toMatchObject({ width: 360, height: 640 });
    const cover = path.join(dir, "logo.jpg");
    const shot = await runFfmpeg(coverArgs({ source, at: 1, width: 360, height: 640, captions: "l.ass", output: cover, logo: place }), { cwd: dir });
    expect(shot.stderr).toBe("");
    expect(await probe(cover)).toMatchObject({ width: 360, height: 640 });
  },
  120_000,
);
