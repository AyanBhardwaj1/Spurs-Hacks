import { expect, test } from "bun:test";
import { CHUNK_BYTES, checkChunk, parseNewJob, parseRange, type NewJob } from "./requests";

const valid: NewJob = { title: "City v United", sport: "soccer", placements: ["tiktok", "x-video"], fileName: "match.mp4", size: 2_000_000_000 };

test("a new job needs a title, a known sport, known platforms and a video file under the size cap", () => {
  expect(parseNewJob(valid)).toEqual({ ok: true, value: valid });
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
});
