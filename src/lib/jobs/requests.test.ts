import { expect, test } from "bun:test";
import { CHUNK_BYTES, checkChunk, parseAddPlacements, parseNewJob, parseRange, parseTrim, type NewJob } from "./requests";

const valid: NewJob = { title: "City v United", sport: "soccer", placements: ["tiktok", "x-video"], fileName: "match.mp4", size: 2_000_000_000 };

test("a new job needs a title, a known sport, known platforms and a video file under the size cap", () => {
  expect(parseNewJob(valid)).toEqual({ ok: true, value: valid });
  expect(parseNewJob({ ...valid, replay: true })).toEqual({ ok: true, value: { ...valid, replay: true } });
  expect(parseNewJob({ ...valid, replay: false })).toEqual({ ok: true, value: valid });
  expect(parseNewJob({ ...valid, replay: "yes" })).toMatchObject({ ok: false });
  expect(parseNewJob({ ...valid, title: "  " })).toMatchObject({ ok: false });
  expect(parseNewJob({ ...valid, sport: "curling" })).toMatchObject({ ok: false });
  expect(parseNewJob({ ...valid, placements: [] })).toMatchObject({ ok: false });
  expect(parseNewJob({ ...valid, placements: ["tiktok", "myspace"] })).toMatchObject({ ok: false });
  expect(parseNewJob({ ...valid, fileName: "match.exe" })).toMatchObject({ ok: false });
  expect(parseNewJob({ ...valid, size: 0 })).toMatchObject({ ok: false });
  expect(parseNewJob({ ...valid, size: 50 * 1024 ** 3 })).toMatchObject({ ok: false });
  expect(parseNewJob(null)).toMatchObject({ ok: false });
});

test("platforms are deduplicated and the title is trimmed", () => {
  expect(parseNewJob({ ...valid, title: "  Final  ", placements: ["tiktok", "tiktok"] })).toEqual({ ok: true, value: { ...valid, title: "Final", placements: ["tiktok"] } });
});

test("a chunk is taken only where the upload left off, so a retry resumes and a gap or overlap is refused", () => {
  expect(checkChunk({ received: 0, size: 20 }, 0, 10)).toEqual({ ok: true });
  expect(checkChunk({ received: 10, size: 20 }, 0, 10)).toEqual({ ok: false, status: 409, received: 10 });
  expect(checkChunk({ received: 10, size: 20 }, 15, 5)).toEqual({ ok: false, status: 409, received: 10 });
  expect(checkChunk({ received: 10, size: 20 }, 10, 11)).toMatchObject({ ok: false, status: 400 });
  expect(checkChunk({ received: 0, size: CHUNK_BYTES * 4 }, 0, CHUNK_BYTES + 1)).toMatchObject({ ok: false, status: 413 });
  expect(checkChunk({ received: 0, size: 20 }, 0, 0)).toMatchObject({ ok: false, status: 400 });
});

test("byte ranges for seeking a video", () => {
  expect(parseRange(null, 1000)).toBeNull();
  expect(parseRange("bytes=0-499", 1000)).toEqual({ start: 0, end: 499 });
  expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  expect(parseRange("bytes=-200", 1000)).toEqual({ start: 800, end: 999 });
  expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
  expect(parseRange("bytes=0-1,5-9", 1000)).toBeNull();
  expect(parseRange("items=0-1", 1000)).toBeNull();
  expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
  expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
});

const clip = { placement: "tiktok" as const, segments: [{ start: 100, end: 118 }] };

test("a trim moves a single-segment clip's edges inside the video and the platform's length limits", () => {
  expect(parseTrim({ start: 98.5, end: 121 }, clip, 600)).toEqual({ ok: true, value: [{ start: 98.5, end: 121 }] });
  expect(parseTrim({ start: -1, end: 20 }, clip, 600)).toMatchObject({ ok: false });
  expect(parseTrim({ start: 590, end: 601 }, clip, 600)).toMatchObject({ ok: false });
  expect(parseTrim({ start: 100, end: 101 }, clip, 600)).toMatchObject({ ok: false });
  expect(parseTrim({ start: 0, end: 700 }, clip, 900)).toMatchObject({ ok: false });
  expect(parseTrim({ start: "1", end: 20 }, clip, 600)).toMatchObject({ ok: false });
  expect(parseTrim({ start: 10, end: 30 }, { placement: "youtube-video", segments: [{ start: 1, end: 9 }, { start: 20, end: 30 }] }, 600)).toMatchObject({ ok: false });
});

test("added platforms must be known and new to the job", () => {
  expect(parseAddPlacements({ placements: ["x-square", "youtube-video"] }, ["tiktok"])).toEqual({ ok: true, value: ["x-square", "youtube-video"] });
  expect(parseAddPlacements({ placements: ["tiktok"] }, ["tiktok"])).toMatchObject({ ok: false });
  expect(parseAddPlacements({ placements: ["myspace"] }, ["tiktok"])).toMatchObject({ ok: false });
  expect(parseAddPlacements({ placements: [] }, ["tiktok"])).toMatchObject({ ok: false });
});
