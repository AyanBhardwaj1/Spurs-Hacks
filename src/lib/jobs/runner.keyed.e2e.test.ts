import { afterAll, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// The whole pipeline with an OpenAI key, offline: the transcription and chat endpoints are answered by a
// stand-in, so the transcript, the commentary moment, following the play and the model's copy all run
// against the real ffmpeg work around them.

mock.module("server-only", () => ({}));
const dir = mkdtempSync(path.join(tmpdir(), "rundown-keyed-"));
process.env.RUNDOWN_DATA_DIR = dir;
const { appendChunk, createJob, getJob } = await import("./store");
const { runJob } = await import("./runner");
const { runFfmpeg } = await import("./ffmpeg");

const originalKey = process.env.OPENAI_API_KEY;
afterAll(() => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  rmSync(dir, { recursive: true, force: true });
});
const haveFfmpeg = Boolean(process.env.FFMPEG_PATH || (ffmpegStatic && existsSync(ffmpegStatic)));

function openaiStandIn() {
  const calls = { transcriptions: 0, positions: 0, copy: 0 };
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/audio/transcriptions")) {
        calls.transcriptions += 1;
        return Response.json({ words: [{ word: "what", start: 29, end: 29.3 }, { word: "a", start: 29.3, end: 29.4 }, { word: "goal!", start: 29.4, end: 29.9 }] });
      }
      const body = JSON.parse(String(init?.body));
      const name = body.response_format.json_schema.name;
      if (name === "play_position") {
        calls.positions += 1;
        const count = body.messages[1].content.length - 1;
        return Response.json({ choices: [{ message: { content: JSON.stringify({ frames: Array.from({ length: count }, (_, frame) => ({ frame, x: 0.8, ballVisible: true })) }) } }] });
      }
      calls.copy += 1;
      const ids = (JSON.parse(body.messages[1].content).clips as { id: string }[]).map((c) => c.id);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ clips: ids.map((id) => ({ id, hook: "What a goal", caption: "Late drama", title: "The winner" })) }) } }] });
    }, { preconnect: fetch.preconnect }),
  );
  return { calls, fetchMock };
}

test.skipIf(!haveFfmpeg)(
  "with a key, the transcript adds a commentary moment, the crop follows the play and the model writes the copy",
  async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const { calls, fetchMock } = openaiStandIn();
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
    let job = await createJob({ title: "Keyed FC v Test United", sport: "soccer", placements: ["tiktok", "x-square"], fileName: "match.mp4", size: bytes.byteLength });
    job = await appendChunk(job, bytes);

    await runJob(job.id);
    fetchMock.mockRestore();
    job = (await getJob(job.id))!;
    const stage = (id: string) => job.stages.find((s) => s.id === id)!;
    expect(job.status).toBe("done");
    expect(stage("transcript").state).toBe("done");
    expect(job.services).toEqual({ transcript: true, model: true });
    expect(calls.transcriptions).toBe(1);

    const goal = job.moments.find((m) => Math.abs(m.peak - 30) <= 3)!;
    expect(goal.signals).toEqual(["crowd", "commentary"]);

    expect(stage("focus").state).toBe("done");
    expect(calls.positions).toBeGreaterThan(0);
    expect(goal.focus!.length).toBeGreaterThan(0);
    for (const k of goal.focus!) expect(k.x).toBeCloseTo(0.8, 1);

    expect(calls.copy).toBe(1);
    for (const clip of job.clips) {
      expect(clip.hook).toBe("What a goal");
      expect(clip.render.state).toBe("ready");
    }
  },
  300_000,
);
