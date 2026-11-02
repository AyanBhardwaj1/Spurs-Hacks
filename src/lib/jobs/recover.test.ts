import { afterAll, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

mock.module("server-only", () => ({}));
const dir = mkdtempSync(path.join(tmpdir(), "rundown-recover-"));
process.env.RUNDOWN_DATA_DIR = dir;
process.env.RUNDOWN_RUNNER = "off";
const { createJob, getJob, saveJob } = await import("./store");
const { isActive, queuedJobs, recoverJobs } = await import("./runner");

afterAll(() => {
  delete process.env.RUNDOWN_RUNNER;
  rmSync(dir, { recursive: true, force: true });
});

test("after a restart, waiting and interrupted jobs run again, and one interrupted twice stops", async () => {
  const make = async (status: "queued" | "running" | "done", attempts?: number) => {
    const job = await createJob({ title: status, sport: "soccer", placements: ["tiktok"], fileName: "m.mp4", size: 1 });
    await saveJob({ ...job, status, attempts, stages: job.stages.map((s) => (s.id === "render" ? { ...s, state: status === "running" ? "running" : s.state } : s)) });
    return job.id;
  };
  const queued = await make("queued");
  const running = await make("running");
  const looping = await make("running", 2);
  const done = await make("done");

  await recoverJobs();
  expect(queuedJobs()).toEqual(expect.arrayContaining([queued, running]));
  expect(isActive(running)).toBe(true);
  expect((await getJob(running))!).toMatchObject({ status: "queued", attempts: 1 });
  expect((await getJob(running))!.stages.find((s) => s.id === "render")!.state).toBe("waiting");
  expect((await getJob(looping))!).toMatchObject({ status: "failed" });
  expect(isActive(looping)).toBe(false);
  expect(isActive(done)).toBe(false);
});
