import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { MatchAnalysis, Moment } from "../../src/lib/studio/types";
import { applyWriteback, rehearsalWriteback, pendingLogs, writebackDetail, writebackKey } from "./writeback";

const moment: Moment = { id: "m-goal", kind: "goal", title: "Equaliser", summary: "Header", start: 10, peak: 15, end: 20, players: [], team: "spurs", evidence: [], focus: [], scores: { importance: 1, emotion: 1, crowd: 1, social: 0, total: 0.9 } };

test("fails if rerunning after a lost response duplicates a remote log", () => {
  const key = writebackKey(130852725, moment);
  const renamed = { ...moment, title: "Edited headline" };
  expect(writebackKey(130852725, renamed)).toBe(key);
  expect(writebackKey(130852725, { ...moment, end: 21 })).not.toBe(key);
  expect(writebackKey(130852726, moment)).not.toBe(key);
  expect(pendingLogs([moment], [{ comment: `Equaliser [${key}]` }], { [key]: { state: "pending", momentId: moment.id } })).toEqual([]);
  expect(pendingLogs([moment], [], {})).toEqual([moment]);
  expect(() => pendingLogs([moment], [], { [key]: { state: "pending", momentId: moment.id } })).toThrow("reconcile");
});

test("fails if rehearsal tags become confirmed analysis metadata", () => {
  const source = { id: 1, name: "Match", durationSec: 20, width: 1920, height: 1080, fps: 25, previewUrl: "", players: [], tags: ["Existing"] };
  const analysis: Pick<MatchAnalysis, "source" | "writeback"> = { source };
  const rehearsal = rehearsalWriteback([{ ...moment, tags: ["Proposed"] }], 12);
  expect(rehearsal.kind).toBe("rehearsal");
  applyWriteback(analysis, rehearsal);
  expect(analysis.writeback).toBeUndefined();
  expect(analysis.source.tags).toEqual(["Existing"]);
  const confirmed = { videoLogs: 10, tags: ["Confirmed"], at: "2026-10-22T00:00:00Z", momentIds: [moment.id] };
  applyWriteback(analysis, rehearsalWriteback([{ ...moment, tags: ["Proposed"] }], 12, confirmed));
  expect(analysis.writeback).toEqual(confirmed);
  expect(analysis.source.tags).toEqual(["Existing", "Confirmed"]);
});

test("fails if read-back moments are missing from the persisted receipt or a rehearsal changes them", async () => {
  const root = mkdtempSync(join(tmpdir(), "studio-writeback-"));
  const scriptDir = join(root, "scripts", "studio");
  const libDir = join(root, "src", "lib");
  const cacheDir = join(root, ".media", "studio");
  for (const dir of [scriptDir, libDir, cacheDir]) mkdirSync(dir, { recursive: true });
  for (const name of ["writeback.ts", "cache.ts"]) copyFileSync(join(import.meta.dir, name), join(scriptDir, name));
  copyFileSync(join(import.meta.dir, "../../src/lib/scoreplay.ts"), join(libDir, "scoreplay.ts"));
  writeFileSync(join(scriptDir, "server-modules.ts"), `Bun.plugin({ name: "test-server-only", setup(build) { build.module("server-only", () => ({ contents: "", loader: "js" })); } }); export const scoreplay = await import("../../src/lib/scoreplay");`);
  const key = writebackKey(130852725, moment);
  const requests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    requests.push(`${request.method} ${path}`);
    if (request.method !== "GET") return new Response("No writes allowed", { status: 405 });
    if (path === "/media/130852725/logs") return Response.json({ items: [{ comment: `[${key}]` }], total: 1 });
    if (path === "/media/130852725") return Response.json({ company_id: 7, tags: [] });
    return new Response(null, { status: 404 });
  } });
  const run = async (rehearsal: boolean) => {
    const child = Bun.spawn([process.execPath, "-e", `import { writeback } from "./scripts/studio/writeback.ts"; await writeback(${JSON.stringify([{ ...moment, id: rehearsal ? "new-proposal" : moment.id }])});`], {
      cwd: root, stdout: "pipe", stderr: "pipe",
      env: { ...process.env, SCOREPLAY_API_URL: server.url.toString(), SCOREPLAY_API_KEY: "test-key", STUDIO_CACHE_ONLY: "0", STUDIO_NO_WRITES: rehearsal ? "1" : "0" },
    });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
  };
  try {
    await run(false);
    const journal = JSON.parse(readFileSync(join(cacheDir, "writeback.json"), "utf8"));
    expect(journal.confirmed.momentIds).toEqual([moment.id]);
    expect(journal.logs[key]).toEqual({ state: "written", momentId: moment.id });
    const receipt = readFileSync(join(cacheDir, "writeback.json"), "utf8");
    await run(true);
    expect(readFileSync(join(cacheDir, "writeback.json"), "utf8")).toBe(receipt);
    expect(requests.every((request) => request.startsWith("GET "))).toBe(true);
  } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

test("fails if a rehearsal rerun hides a writeback that ScorePlay already confirmed", () => {
  const confirmed = { videoLogs: 30, tags: ["Goal", "Rundown"], at: "2026-10-23T09:01:41.646Z", momentIds: ["m-goal"] };
  expect(writebackDetail({ kind: "confirmed", confirmed }, 7)).toBe("Read back 30 video logs on media 7; Goal, Rundown attached to the source");
  expect(writebackDetail(rehearsalWriteback([{ ...moment, tags: ["Goal"] }], 30, confirmed), 7)).toBe(
    "30 video logs on media 7, confirmed by an earlier write; this rerun wrote nothing new",
  );
  expect(writebackDetail(rehearsalWriteback([{ ...moment, tags: ["Goal"] }], 0), 7)).toBe("Rehearsal: Goal proposed; no writes confirmed");
});
