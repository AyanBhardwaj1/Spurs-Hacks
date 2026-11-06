import { expect, test } from "bun:test";
import { applyCopy, copyPrompt, isCopyAnswer } from "./copy";
import type { JobClip } from "./types";

const clip = (id: string, placement: JobClip["placement"]): JobClip => ({
  id, momentId: "m-1", placement, segments: [{ start: 10, end: 28 }], title: "Crowd erupts at 0:20", hook: "Listen to this crowd",
  caption: "Listen to this crowd · 0:20 · City v United", hashtags: ["football", "soccer"], why: "rule", render: { state: "waiting" },
});

test("the answer's shape is checked before it is used", () => {
  expect(isCopyAnswer({ clips: [{ id: "a", hook: "h", caption: "c", title: "t" }] })).toBe(true);
  expect(isCopyAnswer({ clips: [{ id: "a", hook: 3 }] })).toBe(false);
  expect(isCopyAnswer({})).toBe(false);
  expect(isCopyAnswer(null)).toBe(false);
});

test("model copy replaces rule copy within each platform's limits, and never touches cuts or hashtags", () => {
  const clips = [clip("x-video-m-1", "x-video"), clip("tiktok-m-1", "tiktok")];
  const out = applyCopy(clips, {
    clips: [
      { id: "x-video-m-1", hook: "SCENES at the Etihad", caption: "x".repeat(400), title: "Late winner" },
      { id: "tiktok-m-1", hook: "  ", caption: "Wait for the bench 👀", title: "" },
      { id: "made-up", hook: "h", caption: "c", title: "t" },
    ],
  });
  const [x, tiktok] = out;
  expect(x.hook).toBe("SCENES at the Etihad");
  expect(`${x.caption} ${x.hashtags.map((h) => `#${h}`).join(" ")}`.length).toBeLessThanOrEqual(280);
  expect(x.segments).toEqual(clips[0].segments);
  expect(x.hashtags).toEqual(["football", "soccer"]);
  expect(tiktok.hook).toBe("Listen to this crowd");
  expect(tiktok.caption).toBe("Wait for the bench 👀");
  expect(tiktok.title).toBe("Crowd erupts at 0:20");
  expect(out).toHaveLength(2);
  expect(clips[0].hook).toBe("Listen to this crowd");
});

test("with a post language, the model is told to write in it whatever the commentary's language", () => {
  const { system, user } = copyPrompt([], [], "soccer", "Final", "Spanish");
  expect(system).toContain("Write the hook, caption and title in Spanish");
  expect(JSON.parse(user).language).toBe("Spanish");
  expect(copyPrompt([], [], "soccer", "Final").system).not.toContain("Write the hook, caption and title in");
});
