import { expect, test } from "bun:test";
import { CHUNK_BYTES, checkChunk, checkLogo, parseAddPlacements, parseNewJob, parseRange, parseTrim, type NewJob } from "./requests";

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

test("a brand colour is a #RRGGBB hex, kept upper case", () => {
  expect(parseNewJob({ ...valid, colour: "#ffd60a" })).toEqual({ ok: true, value: { ...valid, colour: "#FFD60A" } });
  expect(parseNewJob({ ...valid, colour: "gold" })).toMatchObject({ ok: false });
});

test("a logo is a PNG or JPEG of at most 2 MB", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]);
  expect(checkLogo(png)).toEqual({ ok: true, value: "png" });
  expect(checkLogo(jpeg)).toEqual({ ok: true, value: "jpg" });
  expect(checkLogo(new TextEncoder().encode("<svg></svg>"))).toMatchObject({ ok: false });
  expect(checkLogo(new Uint8Array(2 * 1024 ** 2 + 1).fill(0x89))).toMatchObject({ ok: false });
});
