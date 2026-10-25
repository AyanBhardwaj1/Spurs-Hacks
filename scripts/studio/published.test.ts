import { describe, expect, test } from "bun:test";
import type { Clip } from "../../src/lib/studio/types";
import { applyPublished, assertRenderChange, type PublishRecord } from "./published";

const clip = (id: string, title: string): Clip => ({
  id,
  lane: "asap",
  variant: "Goal",
  format: "9:16",
  title,
  caption: "",
  hashtags: ["#COYS"],
  segments: [{ start: 10, end: 30, momentId: "m-0020-goal" }],
  durationSec: 20,
  viralScore: 0.5,
  rationale: "",
});

describe("applyPublished", () => {
  const record: PublishRecord = {
    eventId: 1,
    clips: [
      { clipId: "c-a", clip: clip("c-a", "as uploaded"), file: "a.mp4", renderMs: 1000, bytes: 1, name: "A", mediaId: 42, uploadMs: 500 },
      { clipId: "c-b", clip: clip("c-b", "dropped by the new plan"), file: "b.mp4", renderMs: 1000, bytes: 1, name: "B", mediaId: 43 },
    ],
  };

  test("an uploaded clip replaces a re-planned clip of the same ID and survives being dropped from the plan", () => {
    const analysis = { clips: [clip("c-a", "re-planned"), clip("c-new", "new")], stages: [] };
    applyPublished(analysis, record);
    expect(analysis.clips.map((c) => [c.id, c.title, c.scoreplayMediaId])).toEqual([
      ["c-a", "as uploaded", 42],
      ["c-new", "new", undefined],
      ["c-b", "dropped by the new plan", 43],
    ]);
  });
});

test("fails if a creation receipt appears in analysis as a published clip", () => {
  const record: PublishRecord = { eventId: 1, clips: [{ clipId: "c-a", clip: clip("c-a", "Pending"), file: "a.mp4", renderMs: 1, bytes: 3, name: "A", mediaId: 42, state: "created" }] };
  const analysis = { clips: [clip("c-a", "Planned")], stages: [] };
  applyPublished(analysis, record);
  expect(analysis.clips[0].scoreplayMediaId).toBeUndefined();
  record.clips[0].state = "tagged";
  applyPublished(analysis, record);
  expect(analysis.clips[0].scoreplayMediaId).toBe(42);
});

test("fails if a changed cut can retain old media without explicit replacement", () => {
  const entry = { clipId: "c-a", clip: clip("c-a", "Old cut"), file: "a.mp4", renderMs: 1, bytes: 3, name: "A", mediaId: 42, state: "tagged", renderKey: "old" } satisfies import("./published").PublishedClip;
  expect(() => assertRenderChange(entry, "new", false)).toThrow("Clip c-a");
  expect(() => assertRenderChange(entry, "new", false)).toThrow("--replace-media=42");
  expect(() => assertRenderChange(entry, "new", true)).not.toThrow();
  expect(() => assertRenderChange(entry, "old", false)).not.toThrow();
  const record: PublishRecord = { eventId: 1, clips: [{ ...entry, replacement: { ...entry, mediaId: undefined, state: undefined, clip: clip("c-a", "New cut"), renderKey: "new" } }] };
  const analysis = { clips: [clip("c-a", "New plan")], stages: [] };
  applyPublished(analysis, record);
  expect(analysis.clips[0].title).toBe("Old cut");
  expect(analysis.clips[0].scoreplayMediaId).toBe(42);
});
