import { afterAll, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// The slow-motion replay through the real ffmpeg: the filters it adds (setpts, atempo) have to fit the
// graph the clip already uses, with sound and without.

mock.module("server-only", () => ({}));
const dir = mkdtempSync(path.join(tmpdir(), "rundown-replay-"));
const { renderArgs, clipAss } = await import("./captions");
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
