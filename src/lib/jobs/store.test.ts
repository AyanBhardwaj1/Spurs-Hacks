import { afterAll, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

mock.module("server-only", () => ({}));
const dir = mkdtempSync(path.join(tmpdir(), "rundown-jobs-"));
process.env.RUNDOWN_DATA_DIR = dir;
const { appendChunk, createJob, getJob, jobFile, updateJob, withJob } = await import("./store");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("an upload in pieces becomes the source file once the last piece lands", async () => {
  const job = await createJob({ title: "T", sport: "soccer", placements: ["tiktok"], fileName: "Match.MP4", size: 6 });
  const half = await appendChunk(job, new Uint8Array([1, 2, 3]));
  expect(half.status).toBe("uploading");
  const whole = await appendChunk(half, new Uint8Array([4, 5, 6]));
  expect(whole.status).toBe("queued");
  expect(whole.stages.find((s) => s.id === "upload")!.state).toBe("done");
  expect([...new Uint8Array(await Bun.file(jobFile.source(job.id, "Match.MP4")).arrayBuffer())]).toEqual([1, 2, 3, 4, 5, 6]);
  expect(jobFile.source(job.id, "Match.MP4").endsWith("source.mp4")).toBe(true);
});

test("changes to one job apply in order, so concurrent writers do not lose each other's work", async () => {
  const job = await createJob({ title: "T", sport: "soccer", placements: ["tiktok"], fileName: "m.mp4", size: 1 });
  await Promise.all(Array.from({ length: 20 }, (_, i) => updateJob(job.id, (j) => ({ ...j, title: `${j.title}${i % 10}` }))));
  expect((await getJob(job.id))!.title).toHaveLength(21);
  const order: number[] = [];
  await Promise.all([withJob(job.id, async () => { await Bun.sleep(5); order.push(1); }), withJob(job.id, async () => { order.push(2); })]);
  expect(order).toEqual([1, 2]);
});

test("ids that are not a job's or a clip's never reach the filesystem", async () => {
  expect(await getJob("../../etc/passwd")).toBeUndefined();
  expect(() => jobFile.clip("00000000-0000-0000-0000-000000000000", "../x")).toThrow();
});
