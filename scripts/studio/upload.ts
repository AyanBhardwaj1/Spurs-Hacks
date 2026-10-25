import { readFileSync } from "node:fs";
import type { PublishedClip } from "./published";

export function reconciledUpload(entry: Pick<PublishedClip, "mediaId" | "uploadedBytes" | "bytes" | "name">, eventId: number, media: { ID: number; event_id: number; name: string; status: string; video?: { file_size: string } }): "completed" {
  if (media.ID !== entry.mediaId || media.event_id !== eventId || media.name !== entry.name
    || media.status !== "DONE" || Number(media.video?.file_size) !== (entry.uploadedBytes ?? entry.bytes)) {
    throw new Error(`Media ${entry.mediaId} is ${media.status} with size ${media.video?.file_size ?? "unknown"}; reconcile this receipt before retrying, no new media was created`);
  }
  return "completed";
}

type UploadOptions = {
  eventId: number;
  description: string;
  rawTags: string[];
  tagIds: number[];
  players: number[];
  replace: boolean;
};

/** Persist each remote receipt before proceeding, so a lost completion or tagging response can resume. */
export async function publishUpload(entry: PublishedClip, options: UploadOptions, save: () => void, api = {
  url: process.env.SCOREPLAY_API_URL ?? "https://media.scoreplay.io/v1",
  key: process.env.SCOREPLAY_API_KEY,
}): Promise<void> {
  if (process.env.STUDIO_NO_WRITES === "1" || process.env.STUDIO_CACHE_ONLY === "1") throw new Error("Studio writes are disabled");
  const key = api.key;
  if (!key) throw new Error("SCOREPLAY_API_KEY is not set");
  const request = async (path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`${api.url.replace(/\/$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-ScorePlay-Api-Key": key, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`ScorePlay ${response.status} on ${path}`);
    return response.status === 204 ? undefined : response.json();
  };
  if (entry.pendingCreation && !entry.mediaId) {
    const attempt = entry.pendingCreation;
    if (attempt.clipId !== entry.clipId || attempt.name !== entry.name) throw new Error(`Clip ${entry.clipId} pending creation differs from its plan; manual reconciliation required`);
    const matches = new Set<number>();
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (;;) {
      const page = await request("/media/search", { limit: 100, event_ids: [options.eventId], ...(cursor ? { cursor } : {}) });
      if (typeof page !== "object" || page === null || !("media" in page) || !Array.isArray(page.media)) throw new Error("Invalid media search response; manual reconciliation required");
      for (const media of page.media) {
        if (typeof media !== "object" || media === null || !("ID" in media) || typeof media.ID !== "number" || !Number.isSafeInteger(media.ID) || media.ID < 1
          || !("event_id" in media) || typeof media.event_id !== "number" || !("name" in media) || typeof media.name !== "string") throw new Error("Invalid media search item; manual reconciliation required");
        if (media.event_id === options.eventId && media.name === attempt.name) matches.add(media.ID);
      }
      if (!("next_cursor" in page) || !page.next_cursor) break;
      if (typeof page.next_cursor !== "string" || seen.has(page.next_cursor)) throw new Error("Invalid media search cursor; manual reconciliation required");
      cursor = page.next_cursor;
      seen.add(cursor);
    }
    if (matches.size !== 1) throw new Error(`Clip ${entry.clipId}: ${matches.size} media match pending name "${attempt.name}" from ${attempt.attemptedAt}; manual reconciliation required before creating media`);
    entry.mediaId = [...matches][0];
    entry.state = "created";
    entry.uploadedBytes = entry.bytes;
    delete entry.pendingCreation;
    save();
  }
  if (options.replace && entry.mediaId) throw new Error(`Clip ${entry.clipId}: stage a replacement render before uploading`);
  if (!entry.mediaId) {
    entry.pendingCreation = { clipId: entry.clipId, attemptedAt: new Date().toISOString(), name: entry.name };
    save();
    const created = await request(`/upload/event/${options.eventId}?parts=1`, {
      name: entry.name, description: options.description, raw_tags: options.rawTags,
    });
    if (typeof created !== "object" || created === null || !("media_id" in created)
      || typeof created.media_id !== "number" || !Number.isSafeInteger(created.media_id) || created.media_id < 1) {
      throw new Error("ScorePlay creation response has no valid media_id; reconcile the event before retrying");
    }
    entry.replacesMediaId = entry.mediaId ?? entry.replacesMediaId;
    entry.mediaId = created.media_id;
    entry.state = "created";
    entry.uploadedBytes = entry.bytes;
    delete entry.pendingCreation;
    save();
    if (!("key" in created) || typeof created.key !== "string" || !("upload_id" in created) || typeof created.upload_id !== "string"
      || !("urls" in created) || !Array.isArray(created.urls) || created.urls.length !== 1) throw new Error(`Invalid upload receipt for media ${entry.mediaId}`);
    const part: unknown = created.urls[0];
    if (typeof part !== "object" || part === null || !("url" in part) || typeof part.url !== "string"
      || !("parts_number" in part) || typeof part.parts_number !== "number") throw new Error(`Invalid upload part for media ${entry.mediaId}`);
    const put = await fetch(part.url, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: new Uint8Array(readFileSync(entry.file)) });
    const etag = put.headers.get("etag");
    if (!put.ok || !etag) throw new Error(`Storage did not confirm upload for media ${entry.mediaId}`);
    entry.state = "uploaded";
    save();
    await request(`/upload/complete/${entry.mediaId}`, {
      key: created.key, upload_id: created.upload_id, parts_number: 1,
      parts: [{ parts_number: part.parts_number || 1, etag }],
    });
    entry.state = "completed";
    save();
  } else if (entry.state !== "completed" && entry.state !== "tagged") {
    const value = await request(`/media/${entry.mediaId}`);
    if (typeof value !== "object" || value === null || !("ID" in value) || typeof value.ID !== "number"
      || !("name" in value) || typeof value.name !== "string" || !("event_id" in value) || typeof value.event_id !== "number"
      || !("status" in value) || typeof value.status !== "string") throw new Error(`Invalid media readback for ${entry.mediaId}`);
    const video = "video" in value ? value.video : undefined;
    const size = typeof video === "object" && video !== null && "file_size" in video ? String(video.file_size) : undefined;
    entry.state = reconciledUpload(entry, options.eventId, { ID: value.ID, name: value.name, event_id: value.event_id, status: value.status, video: size === undefined ? undefined : { file_size: size } });
    save();
  }
  if (entry.state !== "tagged") {
    await request(`/media/${entry.mediaId}/tags`, { tag_option_ids: options.tagIds, ...(options.players.length ? { player_ids: options.players } : {}) });
    entry.state = "tagged";
    save();
  }
}
