import { expect, test } from "bun:test";
import { preflight } from "./preflight";
import type { JobClip } from "./types";

const clip = (over: Partial<JobClip> = {}): JobClip => ({
  id: "tiktok-m-30", momentId: "m-30", placement: "tiktok", segments: [{ start: 22, end: 40 }], title: "T", hook: "H", caption: "Big moment", hashtags: ["a", "b"], why: "w",
  render: { state: "ready", file: "tiktok-m-30.mp4", probe: { width: 1080, height: 1920, durationSec: 18.02, hasAudio: true } },
  ...over,
});

test("a rendered clip is checked against its platform from the file itself", () => {
  expect(preflight(clip())).toEqual([
    { label: "1080×1920, the size TikTok wants", ok: true },
    { label: "18 s, within TikTok's 600 s", ok: true },
    { label: "Has sound", ok: true },
    { label: "Post is 16 of 4000 characters", ok: true },
    { label: "2 hashtags, within 5", ok: true },
  ]);
});

test("what would fail on the platform is flagged, and X counts its own way", () => {
  const x = clip({ placement: "x-video", caption: "x".repeat(279), hashtags: ["a"], render: { state: "ready", probe: { width: 1280, height: 720, durationSec: 141, hasAudio: false } } });
  expect(preflight(x).filter((c) => !c.ok).map((c) => c.label)).toEqual(["141 s, over X's 140 s", "No sound", "Post is 282 of 280 characters"]);
  expect(preflight(clip({ render: { state: "ready" } }))).toEqual([]);
});
