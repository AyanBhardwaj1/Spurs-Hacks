import { expect, test } from "bun:test";
import { jobSummary } from "./summary";
import type { Job, JobClip } from "./types";

const clip = (id: string, momentId: string, over: Partial<JobClip> = {}): JobClip => ({
  id, momentId, placement: "tiktok", segments: [{ start: 0, end: 15 }], title: "t", hook: "h", caption: "c", hashtags: [], why: "w", render: { state: "ready", cover: `${id}.jpg` }, ...over,
});
const job: Job = {
  id: "j1", title: "Final", sport: "tennis", placements: ["x-video", "tiktok"], createdAt: "2026-11-06T10:00:00Z", status: "done",
  upload: { fileName: "f.mp4", size: 1, received: 1 }, stages: [], services: { transcript: false, model: false },
  source: { durationSec: 5400, width: 1920, height: 1080, fps: 25, hasAudio: true },
  moments: [
    { id: "a", peak: 100, start: 85, end: 110, score: 0.5, signals: ["crowd"], title: "A" },
    { id: "b", peak: 900, start: 885, end: 910, score: 1, signals: ["crowd"], title: "B" },
  ],
  clips: [
    clip("x-video-a", "a", { placement: "x-video" }),
    clip("x-video-b", "b", { placement: "x-video", decision: { value: "approved", at: "x" } }),
    clip("tiktok-b", "b", { decision: { value: "rejected", at: "x" } }),
    clip("tiktok-a", "a", { render: { state: "waiting" } }),
  ],
  skipped: [],
};

test("a match in the list shows its best wide clip's cover, its counts and its length", () => {
  expect(jobSummary(job)).toEqual({
    id: "j1", title: "Final", sport: "tennis", status: "done", createdAt: "2026-11-06T10:00:00Z", placements: ["x-video", "tiktok"],
    durationSec: 5400, clips: 4, ready: 3, approved: 1, cover: "x-video-b",
  });
  expect(jobSummary({ ...job, clips: [] }).cover).toBeUndefined();
});
