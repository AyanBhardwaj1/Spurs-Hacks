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

test("a finished clip is trimmed and queued to render again, its old approval cleared; new platforms are planned from the job's moments", async () => {
  const trim = await import("./[id]/clips/[clipId]/trim/route");
  const placements = await import("./[id]/placements/route");
  const { job } = await (await jobs.POST(new Request("http://localhost/api/jobs", { method: "POST", body: JSON.stringify({ title: "F", sport: "soccer", placements: ["tiktok"], fileName: "m.mp4", size: 1 }) }))).json();
  await updateJob(job.id, (j) => ({
    ...j,
    status: "done",
    source: { durationSec: 600, width: 1280, height: 720, fps: 25, hasAudio: true },
    moments: [{ id: "m-30", peak: 30, start: 15, end: 40, score: 0.9, signals: ["crowd"], title: "Crowd erupts at 0:30" }],
    clips: [{ id: "tiktok-m-30", momentId: "m-30", placement: "tiktok", segments: [{ start: 22, end: 40 }], title: "t", hook: "h", caption: "c", hashtags: [], why: "w", render: { state: "ready", file: "x.mp4" }, decision: { value: "approved", at: "now" } }],
  }));
  const post = (mod: { POST: (r: Request, c: never) => Promise<Response> }, params: Record<string, string>, body: unknown) =>
    mod.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }), ctx(params) as never);

  const trimmed = await (await post(trim, { id: job.id, clipId: "tiktok-m-30" }, { start: 20, end: 44 })).json();
  expect(trimmed).toMatchObject({ segments: [{ start: 20, end: 44 }], render: { state: "waiting" } });
  expect(trimmed.decision).toBeUndefined();
  expect((await post(trim, { id: job.id, clipId: "tiktok-m-30" }, { start: 20, end: 21 })).status).toBe(409);

  await updateJob(job.id, (j) => ({ ...j, status: "done" }));
  const { queuedJobs } = await import("@/lib/jobs/runner");
  if (queuedJobs().includes(job.id)) {
    // The trim's render is still in line in this runner-off test; adding platforms waits for it.
    expect((await post(placements, { id: job.id }, { placements: ["x-video"] })).status).toBe(409);
  }
});

test("platforms added to a finished job are planned from its moments and queued, and repeats are refused", async () => {
  const placements = await import("./[id]/placements/route");
  const { job } = await (await jobs.POST(new Request("http://localhost/api/jobs", { method: "POST", body: JSON.stringify({ title: "F", sport: "soccer", placements: ["tiktok"], fileName: "m.mp4", size: 1 }) }))).json();
  await updateJob(job.id, (j) => ({
    ...j,
    status: "done",
    source: { durationSec: 600, width: 1280, height: 720, fps: 25, hasAudio: true },
    moments: [{ id: "m-30", peak: 30, start: 15, end: 40, score: 0.9, signals: ["crowd"], title: "Crowd erupts at 0:30" }],
  }));
  const add = (body: unknown) => placements.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }), ctx({ id: job.id }) as never);
  const res = await add({ placements: ["x-video", "tiktok"] });
  expect(res.status).toBe(200);
  const next = await res.json();
  expect(next.placements).toEqual(["tiktok", "x-video"]);
  expect(next.clips.map((c: { id: string }) => c.id)).toEqual(["x-video-m-30"]);
  expect(next.status).toBe("queued");
  expect((await add({ placements: ["tiktok"] })).status).toBe(409);
});

test("a second the producer picks becomes a moment with a clip for each short platform, queued to render", async () => {
  const moments = await import("./[id]/moments/route");
  const { job } = await (await jobs.POST(new Request("http://localhost/api/jobs", { method: "POST", body: JSON.stringify({ title: "F", sport: "tennis", placements: ["tiktok", "youtube-video"], fileName: "m.mp4", size: 1 }) }))).json();
  const pick = (body: unknown) => moments.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }), ctx({ id: job.id }) as never);
  expect((await pick({ at: 100 })).status).toBe(404);
  await updateJob(job.id, (j) => ({ ...j, status: "done", source: { durationSec: 600, width: 1280, height: 720, fps: 25, hasAudio: true } }));
  expect((await pick({ at: 900 })).status).toBe(400);
  const res = await pick({ at: 100.4 });
  expect(res.status).toBe(201);
  const next = await res.json();
  expect(next.moments.map((m: { id: string; signals: string[] }) => [m.id, m.signals])).toEqual([["m-100", ["producer"]]]);
  expect(next.clips.map((c: { id: string }) => c.id)).toEqual(["tiktok-m-100"]);
  expect(next.status).toBe("queued");
  expect(queuedJobs()).toContain(job.id);
  expect((await pick({ at: 200 })).status).toBe(409);
});

test("a new hook re-renders the clip and clears its approval", async () => {
  const hookRoute = await import("./[id]/clips/[clipId]/hook/route");
  const { job } = await (await jobs.POST(new Request("http://localhost/api/jobs", { method: "POST", body: JSON.stringify({ title: "F", sport: "soccer", placements: ["tiktok"], fileName: "m.mp4", size: 1 }) }))).json();
  await updateJob(job.id, (j) => ({
    ...j,
    status: "done",
    clips: [{ id: "tiktok-m-30", momentId: "m-30", placement: "tiktok", segments: [{ start: 22, end: 40 }], title: "T", hook: "Listen to this crowd", caption: "C", hashtags: [], why: "w", render: { state: "ready", file: "tiktok-m-30.mp4" }, decision: { value: "approved", at: "2026-11-06T00:00:00Z" } }],
  }));
  const send = (body: unknown) => hookRoute.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }), ctx({ id: job.id, clipId: "tiktok-m-30" }) as never);
  expect((await send({ hook: "" })).status).toBe(400);
  const res = await send({ hook: "Wait for it…" });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ hook: "Wait for it…", render: { state: "waiting" } });
  const saved = (await listJobs()).find((j) => j.id === job.id)!;
  expect(saved.clips[0].decision).toBeUndefined();
  expect(saved.status).toBe("queued");
  expect((await send({ hook: "Again" })).status).toBe(409);
});

test("a swapped hook also opens the rule-written caption, and leaves a model-written one alone", async () => {
  const hookRoute = await import("./[id]/clips/[clipId]/hook/route");
  const swap = async (caption: string) => {
    const { job } = await (await jobs.POST(new Request("http://localhost/api/jobs", { method: "POST", body: JSON.stringify({ title: "F", sport: "soccer", placements: ["tiktok"], fileName: "m.mp4", size: 1 }) }))).json();
    await updateJob(job.id, (j) => ({
      ...j,
      status: "done",
      clips: [{ id: "tiktok-m-30", momentId: "m-30", placement: "tiktok", segments: [{ start: 22, end: 40 }], title: "T", hook: "Listen to this crowd", caption, hashtags: [], why: "w", render: { state: "ready" } }],
    }));
    const res = await hookRoute.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ hook: "Wait for it…" }) }), ctx({ id: job.id, clipId: "tiktok-m-30" }) as never);
    return (await res.json()).caption;
  };
  expect(await swap("Listen to this crowd · 0:30 · F")).toBe("Wait for it… · 0:30 · F");
  expect(await swap("A model's own words")).toBe("A model's own words");
});

test("a job file another process rewrote is read again, not served from memory", async () => {
  const { getJob } = await import("@/lib/jobs/store");
  const { writeFileSync, statSync, utimesSync } = await import("node:fs");
  const { job } = await (await jobs.POST(new Request("http://localhost/api/jobs", { method: "POST", body: JSON.stringify({ title: "Before", sport: "soccer", placements: ["tiktok"], fileName: "m.mp4", size: 1 }) }))).json();
  expect((await getJob(job.id))!.title).toBe("Before");
  const file = path.join(dir, "jobs", job.id, "job.json");
  writeFileSync(file, JSON.stringify({ ...job, title: "After" }));
  const later = new Date(statSync(file).mtimeMs + 5000);
  utimesSync(file, later, later);
  expect((await getJob(job.id))!.title).toBe("After");
});

test("trimming a one-segment highlights cut moves its chapters with the new start", async () => {
  const trim = await import("./[id]/clips/[clipId]/trim/route");
  const { job } = await (await jobs.POST(new Request("http://localhost/api/jobs", { method: "POST", body: JSON.stringify({ title: "F", sport: "soccer", placements: ["youtube-video"], fileName: "m.mp4", size: 1 }) }))).json();
  const m = (peak: number) => ({ id: `m-${peak}`, peak, start: peak - 15, end: peak + 10, score: 1, signals: ["crowd" as const], title: `Crowd erupts at ${peak}` });
  await updateJob(job.id, (j) => ({
    ...j,
    status: "done",
    source: { durationSec: 600, width: 1280, height: 720, fps: 25, hasAudio: true },
    moments: [m(115), m(130), m(145)],
    clips: [{ id: "youtube-video-highlights", momentId: "m-115", placement: "youtube-video", segments: [{ start: 100, end: 155 }], title: "T", hook: "H", caption: "C", hashtags: [], why: "w", render: { state: "ready" }, chapters: [{ at: 0, label: "a" }, { at: 15, label: "b" }, { at: 30, label: "c" }] }],
  }));
  const res = await trim.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ start: 90, end: 155 }) }), ctx({ id: job.id, clipId: "youtube-video-highlights" }) as never);
  expect(res.status).toBe(200);
  expect((await res.json()).chapters.map((c: { at: number }) => c.at)).toEqual([0, 25, 40]);
});
