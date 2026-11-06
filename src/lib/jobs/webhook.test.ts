import { expect, test } from "bun:test";
import { webhookPayload } from "./webhook";
import type { Job } from "./types";

const job: Job = {
  id: "j1", title: "Final", sport: "tennis", placements: ["tiktok"], createdAt: "2026-11-06T10:00:00Z", status: "done",
  upload: { fileName: "f.mp4", size: 1, received: 1 }, stages: [], services: { transcript: false, model: false },
  source: { durationSec: 600, width: 1920, height: 1080, fps: 25, hasAudio: true },
  moments: [{ id: "m-30", peak: 30, start: 15, end: 40, score: 1, signals: ["crowd"], title: "Crowd erupts at 0:30" }],
  clips: [
    { id: "tiktok-m-30", momentId: "m-30", placement: "tiktok", segments: [{ start: 22, end: 40 }], title: "T", hook: "H", caption: "C", hashtags: ["tennis"], why: "w", render: { state: "ready", cover: "tiktok-m-30.jpg" } },
    { id: "tiktok-m-90", momentId: "m-90", placement: "tiktok", segments: [{ start: 82, end: 100 }], title: "T", hook: "H", caption: "C", hashtags: [], why: "w", render: { state: "failed", error: "x" } },
  ],
  skipped: [],
};

test("a finished job's webhook names the event and lists its rendered clips with their links and posts", () => {
  expect(webhookPayload(job, "https://rundown.example")).toEqual({
    event: "job.done",
    job: { id: "j1", title: "Final", sport: "tennis", status: "done", url: "https://rundown.example/studio/jobs/j1", clips: 2, ready: 1 },
    clips: [
      {
        id: "tiktok-m-30", platform: "TikTok", placement: "Video", order: 1, seconds: 18, hook: "H", post: "C #tennis",
        video: "https://rundown.example/api/jobs/j1/clips/tiktok-m-30?download=1", cover: "https://rundown.example/api/jobs/j1/clips/tiktok-m-30/cover",
      },
    ],
  });
  expect(webhookPayload({ ...job, status: "failed", error: "boom" }, "http://localhost:3000")).toMatchObject({ event: "job.failed", error: "boom" });
});
