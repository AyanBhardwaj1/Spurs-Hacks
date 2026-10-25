import "server-only";

// ScorePlay MAM client. Field names follow the OpenAPI spec at
// developer.scoreplay.io/downloads/scoreplay.yaml: `ID` and the timestamps
// are capitalised, the rest is snake_case, and dates are Unix seconds.

export type SpTagOption = { ID: number; name: string; label?: string };
export type SpPlayer = { ID: number; full_name: string; external_id?: string };
export type SpSponsor = { ID: number; name: string; label?: string };

export type SpTag = {
  tag_option_id?: number;
  player_id?: number;
  sponsor_id?: number;
  name?: string;
  tag_option?: SpTagOption;
  player?: SpPlayer;
  sponsor?: SpSponsor;
};

export type SpEvent = {
  ID: number;
  name: string;
  date?: number;
  full_path?: string;
  media_count?: number;
  players?: SpPlayer[];
  sponsors?: SpSponsor[];
  tag_options?: SpTagOption[];
};

export type SpMedia = {
  ID: number;
  name: string;
  type: string;
  description?: string;
  date?: number;
  company_id: number;
  event_id?: number;
  duration?: number;
  status?: string;
  thumbnail_url?: string;
  streaming_url?: string;
  proxy_medium?: string;
  proxy_small?: string;
  tags?: SpTag[];
  player_ids?: number[];
  sponsor_ids?: number[];
  raw_tags?: string[];
  event?: SpEvent;
};

export type SpMediaSearch = {
  media_type?: "photo" | "video";
  event_id?: number;
  event_ids?: number[];
  players?: number[];
  any_players?: number[];
  not_players?: number[];
  tag_options?: number[];
  any_tag_options?: number[];
  sponsors?: number[];
  name?: string;
  description?: string;
  transcript_query?: string;
  start_date?: number;
  end_date?: number;
  order_by?: "upload_date" | "event_date" | "captured_time" | "name" | "relevance";
  order_type?: "asc" | "desc";
};

export type SpFormatFile = {
  id: string;
  type: string;
  mime_type: string;
  file_url?: string;
};

export type SpTranscript = {
  media_id: number;
  source_language?: string;
  transcripts: {
    language: string;
    is_source: boolean;
    segments: { start: number; end: number; text: string; speaker?: string }[];
  }[];
};

export type SpVideoLogEntry = {
  id: number;
  media_id: number;
  /** Seconds. */
  timestamp: number;
  /** Milliseconds, unlike everything we write. */
  start_timestamp: number;
  end_timestamp: number;
  comment?: string;
  tags: string[];
  playback_url?: string;
};

export type SpVideoLog = {
  media_id: number;
  start_offset: number;
  end_offset: number;
  comment?: string;
  raw_tags?: string[];
  player_ids?: number[];
};

export class ScorePlayError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(`ScorePlay ${status} on ${path}: ${message}`);
  }
}

export function scoreplayConfigured() {
  return Boolean(process.env.SCOREPLAY_API_KEY);
}

async function sp<T>(
  path: string,
  init: { method?: string; query?: Record<string, string | number | boolean | undefined>; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const key = process.env.SCOREPLAY_API_KEY;
  if (!key) throw new ScorePlayError(0, path, "SCOREPLAY_API_KEY is not set");
  const base = process.env.SCOREPLAY_API_URL ?? "https://media.scoreplay.io/v1";
  const url = new URL(base.replace(/\/$/, "") + path);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      "X-ScorePlay-Api-Key": key,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: init.signal,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {}
    throw new ScorePlayError(res.status, path, message.slice(0, 300));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function searchEvents(query?: string) {
  return sp<SpEvent[]>("/event/search", {
    body: { query, is_match: true, per_page: 50 },
  });
}

export async function getEvent(eventId: number) {
  const [event] = await sp<SpEvent[]>("/event/search", { body: { event_id: eventId } });
  return event;
}

/** Every page of a media search. Stops at `limit` to keep a run bounded. */
export async function searchMedia(filter: SpMediaSearch, limit = 500) {
  const out: SpMedia[] = [];
  let cursor: string | undefined;
  while (out.length < limit) {
    const page = await sp<{ media: SpMedia[]; next_cursor?: string }>("/media/search", {
      query: { per_page: 100, cursor },
      body: filter,
    });
    out.push(...page.media);
    if (!page.next_cursor || page.media.length === 0) break;
    cursor = page.next_cursor;
  }
  return out.slice(0, limit);
}

/** `signal` cancels the request, for callers that give up waiting. */
export function getMedia(id: number, signal?: AbortSignal) {
  return sp<SpMedia>(`/media/${id}`, { signal });
}

export function tagSearch(query: string) {
  return sp<{ tags: SpTagOption[]; players: SpPlayer[]; sponsors: SpSponsor[] }>("/tag/search", {
    query: { query: query.slice(0, 60) },
  });
}

export async function getTranscript(id: number) {
  try {
    return await sp<SpTranscript>(`/media/${id}/transcripts`);
  } catch (err) {
    if (err instanceof ScorePlayError && err.status === 404) return undefined;
    throw err;
  }
}

/** Presigned rendition URLs, valid for 24 hours. Needs `can_do_media_download`. */
export async function getStreamFormats(id: number) {
  const res = await sp<{ items: Record<string, SpFormatFile[]> }>(`/media/${id}/formats/clip`);
  return Object.values(res.items ?? {}).flat();
}

export async function findOrCreateTagOption(name: string, label = name) {
  const existing = await sp<SpTagOption[]>("/tag/options", { query: { query: name, limit: 20 } });
  const hit = existing.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit;
  return sp<SpTagOption>("/tag/options", { body: { name, label } });
}

export function addMediaTags(id: number, tags: { tag_option_ids?: number[]; player_ids?: number[] }) {
  return sp<void>(`/media/${id}/tags`, { body: tags });
}

/** Timecoded actions. ScorePlay creates any `raw_tags` that do not exist yet. */
export function addVideoLogs(companyId: number, logs: SpVideoLog[]) {
  return sp<boolean>("/video/logs", {
    body: {
      company_id: companyId,
      video_logs: logs.map(({ media_id, ...log }) => ({ media_id, log })),
    },
  });
}

/**
 * Uploads a finished file into an event as new media: create the record, PUT
 * the bytes to the presigned URL, then complete the multipart upload. One part
 * is enough for a social clip; S3 allows the last part to be any size.
 */
export async function uploadToEvent(
  eventId: number,
  file: { name: string; body: Uint8Array; contentType: string },
  meta: { description?: string; raw_tags?: string[] },
): Promise<SpMedia> {
  const created = await sp<{
    upload_id: string;
    key: string;
    urls: { url: string; parts_number: number }[];
    media_id: number;
  }>(`/upload/event/${eventId}`, {
    query: { parts: 1 },
    body: { name: file.name, description: meta.description, raw_tags: meta.raw_tags },
  });
  const part = created.urls[0];
  const put = await fetch(part.url, {
    method: "PUT",
    headers: { "Content-Type": file.contentType },
    body: file.body as BodyInit,
  });
  const etag = put.headers.get("etag");
  if (!put.ok || !etag) {
    await sp("/upload/abort", { body: { key: created.key, upload_id: created.upload_id } }).catch(() => {});
    throw new ScorePlayError(put.status, "upload part", `Storage refused the upload: ${put.statusText}`);
  }
  return sp<SpMedia>(`/upload/complete/${created.media_id}`, {
    body: { key: created.key, upload_id: created.upload_id, parts_number: 1, parts: [{ parts_number: part.parts_number || 1, etag }] },
  });
}

export function listVideoLogs(id: number) {
  return sp<{ items: SpVideoLogEntry[]; total: number }>(`/media/${id}/logs`, {
    query: { limit: 200 },
  });
}
