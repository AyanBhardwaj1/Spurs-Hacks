import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PublishedClip } from "./published";
import { publishUpload, reconciledUpload } from "./upload";

const clip: PublishedClip["clip"] = { id: "goal", title: "Goal", lane: "asap", variant: "Goal", format: "9:16", caption: "", hashtags: [], segments: [{ start: 0, end: 1 }], durationSec: 1, viralScore: 1, rationale: "" };
const options = { eventId: 7, description: "Goal", rawTags: ["rundown"], tagIds: [8], players: [9], replace: false };

test("fails if uncertain receipts accept wrong media or mismatched bytes", () => {
  const entry = { mediaId: 42, bytes: 3, name: "Goal" };
  const media = { ID: 42, event_id: 7, name: "Goal", status: "DONE", video: { file_size: "3" } };
  expect(reconciledUpload(entry, 7, media)).toBe("completed");
  for (const invalid of [{ ...media, status: "UPLOADING" }, { ...media, ID: 43 }, { ...media, video: { file_size: "4" } }]) {
    expect(() => reconciledUpload(entry, 7, invalid)).toThrow("reconcile");
  }
});

test("fails if a lost completion response creates duplicate media or tagging failures cannot resume", async () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-upload-"));
  const file = join(dir, "test.bin");
  await Bun.write(file, new Uint8Array([1, 2, 3]));
  const entry: PublishedClip = { clipId: clip.id, clip, file, renderMs: 1, bytes: 3, name: "Goal" };
  let persisted: PublishedClip = structuredClone(entry);
  const save = () => { persisted = structuredClone(entry); };
  const requests: string[] = [];
  let completed = false;
  let tagged = false;
  let failTag = true;
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request): Promise<Response> {
      const path = new URL(request.url).pathname;
      requests.push(`${request.method} ${path}`);
      if (path === "/upload/event/7") return Response.json({ media_id: 42, upload_id: "upload", key: "key", urls: [{ url: `${server.url}part`, parts_number: 1 }] });
      if (path === "/part") {
        expect(persisted.mediaId).toBe(42);
        expect(persisted.state).toBe("created");
        expect(new Uint8Array(await request.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
        return new Response(null, { headers: { etag: "part-etag" } });
      }
      if (path === "/upload/complete/42") {
        expect(persisted.state).toBe("uploaded");
        completed = true;
        // The server committed completion but the client cannot decode its response.
        return new Response("truncated JSON");
      }
      if (path === "/media/42") return Response.json({ ID: 42, event_id: 7, name: "Goal", status: completed ? "DONE" : "UPLOADING", video: { file_size: completed ? "3" : "0" } });
      if (path === "/media/42/tags") {
        if (failTag) { failTag = false; return new Response(null, { status: 503 }); }
        expect(await request.json()).toEqual({ tag_option_ids: [8], player_ids: [9] });
        tagged = true;
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    },
  });
  const api = { url: server.url.toString(), key: "test-key" };
  try {
    await expect(publishUpload(entry, options, save, api)).rejects.toThrow();
    expect(persisted.state).toBe("uploaded");
    Object.assign(entry, persisted);
    await expect(publishUpload(entry, options, save, api)).rejects.toThrow("503");
    expect(persisted.state).toBe("completed");
    await publishUpload(entry, options, save, api);
    expect(tagged).toBe(true);
    expect(persisted.state).toBe("tagged");
    expect(requests.filter((r) => r === "POST /upload/event/7")).toHaveLength(1);
    expect(requests).toContain("GET /media/42");
    const before = requests.length;
    await publishUpload(entry, options, save, api);
    expect(requests).toHaveLength(before);
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails if an unfinished creation receipt is replaced instead of reconciled", async () => {
  const entry: PublishedClip = { clipId: clip.id, clip, file: "absent", renderMs: 1, bytes: 3, name: "Goal", mediaId: 42, state: "created" };
  const requests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    return Response.json({ ID: 42, name: "Goal", event_id: 7, status: "UPLOADING", video: { file_size: "0" } });
  } });
  try {
    await expect(publishUpload(entry, options, () => {}, { url: server.url.toString(), key: "test-key" })).rejects.toThrow("reconcile");
    expect(requests).toEqual(["GET /media/42"]);
    expect(entry.mediaId).toBe(42);
    expect(entry.state).toBe("created");
  } finally {
    server.stop(true);
  }
});

test("fails if a lost creation response duplicates media instead of reconciling a saved attempt", async () => {
  const entry: PublishedClip = { clipId: clip.id, clip, file: "absent", renderMs: 1, bytes: 3, name: "Goal" };
  let persisted = structuredClone(entry);
  let creates = 0;
  let matches = 1;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/upload/event/7") {
      creates++;
      expect(persisted.pendingCreation).toMatchObject({ clipId: "goal", name: "Goal" });
      return new Response("lost JSON response");
    }
    if (path === "/media/search") {
      expect(await request.json()).toMatchObject({ event_ids: [7] });
      return Response.json({ media: Array.from({ length: matches }, (_, i) => ({ ID: 42 + i, event_id: 7, name: "Goal" })) });
    }
    if (path === "/media/42") return Response.json({ ID: 42, event_id: 7, name: "Goal", status: "DONE", video: { file_size: "3" } });
    if (path === "/media/42/tags") return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  } });
  const api = { url: server.url.toString(), key: "test-key" };
  const save = () => { persisted = structuredClone(entry); };
  try {
    await expect(publishUpload(entry, options, save, api)).rejects.toThrow();
    expect(persisted.pendingCreation?.attemptedAt).toBeDefined();
    Object.assign(entry, persisted);
    matches = 2;
    await expect(publishUpload(entry, options, save, api)).rejects.toThrow("manual reconciliation");
    matches = 0;
    await expect(publishUpload(entry, options, save, api)).rejects.toThrow("manual reconciliation");
    matches = 1;
    await publishUpload(entry, options, save, api);
    expect(entry.mediaId).toBe(42);
    expect(entry.state).toBe("tagged");
    expect(creates).toBe(1);
    expect(entry.pendingCreation).toBeUndefined();
  } finally { server.stop(true); }
});
