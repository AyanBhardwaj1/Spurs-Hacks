import { expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PublishedClip } from "./published";

test("fails if retrying a completed or in-flight replacement renders or creates another media", async () => {
  const root = mkdtempSync(join(tmpdir(), "studio-publish-"));
  const scriptDir = join(root, "scripts", "studio");
  const dataDir = join(root, "src", "lib", "studio", "data");
  const cacheDir = join(root, ".media", "studio");
  for (const dir of [scriptDir, dataDir, cacheDir]) mkdirSync(dir, { recursive: true });
  for (const name of ["publish.ts", "published.ts", "cache.ts", "upload.ts"]) copyFileSync(join(import.meta.dir, name), join(scriptDir, name));
  const renderMarker = join(root, "rendered");
  const ffmpeg = join(root, "ffmpeg");
  writeFileSync(ffmpeg, `#!${process.execPath}\nif (process.argv.includes("-filters")) console.log(" drawtext "); else { await Bun.write(${JSON.stringify(renderMarker)}, "rendered"); await Bun.write(process.argv.at(-1), new Uint8Array([1,2,3])); }`, { mode: 0o700 });
  writeFileSync(join(scriptDir, "server-modules.ts"), `export const scoreplay = { findOrCreateTagOption: async () => ({ ID: 8 }) }; export const rundownRender = { defaultFont: () => "font", escapeDrawtext: (s) => s, wrapHook: (s) => s };`);
  writeFileSync(join(scriptDir, "render.ts"), `export const renderKey = () => "cut-key"; export const ffmpegArgs = (_spec, output) => [output];`);
  writeFileSync(join(scriptDir, "graphics-job.ts"), `export const graphicsJob = () => ({ forClip: async () => undefined, dispose() {} });`);
  writeFileSync(join(scriptDir, "render-source.ts"), `export const renderSource = async () => ({ url: "unused", metadata: { mediaId: 1, format: "1080p", width: 1920, height: 1080 } });`);
  writeFileSync(join(scriptDir, "validate.ts"), `export function assertAnalysis() {}`);
  writeFileSync(join(scriptDir, "scoreplay.ts"), `export async function getPublishedMedia(id) { const response = await fetch(process.env.SCOREPLAY_API_URL + "media/" + id); return response.json(); }`);
  const clip: PublishedClip["clip"] = { id: "goal", title: "Goal", lane: "asap", variant: "Goal", format: "9:16", caption: "", hashtags: [], segments: [{ start: 0, end: 1 }], durationSec: 1, viralScore: 1, rationale: "" };
  const entry: PublishedClip = { clipId: clip.id, clip, file: join(scriptDir, "out", "goal.mp4"), renderMs: 1, bytes: 3, uploadedBytes: 3, name: "Replacement", mediaId: 99, replacesMediaId: 42, renderKey: "cut-key", state: "tagged" };
  let creates = 0;
  let tags = 0;
  let verifies = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/media/99" && request.method === "GET") {
      verifies++;
      return Response.json({ ID: 99, event_id: 1536147, name: "Replacement", status: "DONE", video: { file_size: "3", duration: 1 } });
    }
    if (path === "/media/99/tags") { tags++; return new Response(null, { status: 204 }); }
    if (path === "/upload/event/1536147") creates++;
    return new Response("Unexpected request", { status: 500 });
  } });
  try {
    const receipts: PublishedClip[] = [
      { ...entry, status: "DONE" },
      { ...entry, status: "FAILED" },
      { ...entry, state: "completed" },
      { ...entry, state: "uploaded" },
      { ...entry, mediaId: 42, replacesMediaId: undefined, renderKey: "old-key", replacement: { ...entry, state: "completed" } },
    ];
    for (const receipt of receipts) {
      writeFileSync(join(dataDir, "mnu-tot.json"), JSON.stringify({ source: { id: 1 }, clips: [{ ...clip, scoreplayMediaId: 42 }], moments: [], stages: [] }));
      writeFileSync(join(cacheDir, "publish.json"), JSON.stringify({ eventId: 1536147, clips: [receipt] }));
      const child = Bun.spawn([process.execPath, join(scriptDir, "publish.ts"), "--replace-media=42"], {
        cwd: root, stdout: "pipe", stderr: "pipe",
        env: { ...process.env, FFMPEG_PATH: ffmpeg, SCOREPLAY_API_URL: server.url.toString(), SCOREPLAY_API_KEY: "test-key", STUDIO_CACHE_ONLY: "0", STUDIO_NO_WRITES: "0" },
      });
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(stderr).toBe("");
      expect(code).toBe(0);
      expect(creates).toBe(0);
      expect(existsSync(renderMarker)).toBe(false);
      const saved = JSON.parse(readFileSync(join(cacheDir, "publish.json"), "utf8"));
      expect(saved.clips[0]).toMatchObject({ mediaId: 99, replacesMediaId: 42, renderKey: "cut-key", state: "tagged", status: "DONE" });
    }
    expect(tags).toBe(3);
    expect(verifies).toBeGreaterThanOrEqual(5);
  } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); }
});
