import { afterAll, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

mock.module("server-only", () => ({}));
process.env.RUNDOWN_RUNNER = "off";
const dir = mkdtempSync(path.join(tmpdir(), "rundown-api-"));
process.env.RUNDOWN_DATA_DIR = dir;
const jobs = await import("./route");
const upload = await import("./[id]/upload/route");
const one = await import("./[id]/route");
const clip = await import("./[id]/clips/[clipId]/route");
const { listJobs, updateJob } = await import("@/lib/jobs/store");
const { queuedJobs } = await import("@/lib/jobs/runner");

afterAll(() => {
  delete process.env.RUNDOWN_RUNNER;
  rmSync(dir, { recursive: true, force: true });
});
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const put = (id: string, offset: number, bytes: number[]) =>
  upload.PUT(new Request(`http://localhost/api/jobs/${id}/upload?offset=${offset}`, { method: "PUT", body: new Uint8Array(bytes) }), ctx({ id }) as never);

test("a job is created, its video goes up in pieces, a wrong offset says where to resume, and the last piece queues it", async () => {
  const created = await jobs.POST(new Request("http://localhost/api/jobs", { method: "POST", body: JSON.stringify({ title: "Final", sport: "basketball", placements: ["tiktok"], fileName: "game.mov", size: 5 }) }));
  expect(created.status).toBe(201);
  const { job, chunkBytes } = await created.json();
  expect(chunkBytes).toBe(8 * 1024 * 1024);

  expect((await put(job.id, 0, [1, 2])).status).toBe(200);
  const resend = await put(job.id, 0, [1, 2]);
  expect(resend.status).toBe(409);
  expect((await resend.json()).received).toBe(2);
  const last = await put(job.id, 2, [3, 4, 5]);
  expect(await last.json()).toEqual({ received: 5, status: "queued" });
  expect(queuedJobs()).toContain(job.id);
  expect((await put(job.id, 5, [6])).status).toBe(409);

  expect((await listJobs()).map((j) => j.id)).toContain(job.id);
  expect((await one.DELETE(new Request("http://localhost"), ctx({ id: job.id }) as never)).status).toBe(409);
});

test("bad requests are refused before they touch a job", async () => {
  expect((await jobs.POST(new Request("http://localhost/api/jobs", { method: "POST", body: "{}" }))).status).toBe(400);
  expect((await put("not-a-job", 0, [1])).status).toBe(404);
  expect((await one.GET(new Request("http://localhost"), ctx({ id: "../../etc" }) as never)).status).toBe(404);
});

test("a producer approves, rejects with a reason, and clears a clip; an unrendered clip does not play", async () => {
  const { job } = await (await jobs.POST(new Request("http://localhost/api/jobs", { method: "POST", body: JSON.stringify({ title: "F", sport: "soccer", placements: ["tiktok"], fileName: "m.mp4", size: 1 }) }))).json();
  await updateJob(job.id, (j) => ({ ...j, clips: [{ id: "tiktok-m-30", momentId: "m-30", placement: "tiktok", segments: [{ start: 22, end: 40 }], title: "t", hook: "h", caption: "c", hashtags: [], why: "w", render: { state: "waiting" } }] }));
  const decide = (body: unknown) => clip.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }), ctx({ id: job.id, clipId: "tiktok-m-30" }) as never);

  expect((await (await decide({ decision: "approved" })).json()).decision.value).toBe("approved");
  expect((await (await decide({ decision: "rejected", reason: " too similar " })).json()).decision).toMatchObject({ value: "rejected", reason: "too similar" });
  expect((await (await decide({ decision: null })).json()).decision).toBeUndefined();
  expect((await decide({ decision: "maybe" })).status).toBe(400);
  expect((await clip.GET(new Request("http://localhost"), ctx({ id: job.id, clipId: "tiktok-m-30" }) as never)).status).toBe(409);
  expect((await clip.GET(new Request("http://localhost"), ctx({ id: job.id, clipId: "nope" }) as never)).status).toBe(404);
});
