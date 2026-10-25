import { cached } from "./cache";

// The few ScorePlay reads the pipeline needs. src/lib/scoreplay.ts imports
// "server-only", which throws outside Next, so scripts keep their own client.
// Every response is cached under .media/studio/scoreplay.

export type SpPlayerRecord = {
  ID: number;
  first_name: string;
  last_name: string;
  full_name: string;
  profile_picture?: string;
};

type SpAttachment = { name: string; url: string };

export type SpMediaRecord = {
  ID: number;
  name: string;
  event_id: number;
  video?: { width: number; height: number; fps: number; duration: number; proxy_medium?: string };
  tags?: { player_id: number; player?: SpPlayerRecord; tag_option?: { name: string } }[];
  attachments?: SpAttachment[] | null;
};

type SearchPage = { media: { ID: number; name: string; event_id: number }[]; next_cursor?: string };

function config() {
  const url = process.env.SCOREPLAY_API_URL;
  const key = process.env.SCOREPLAY_API_KEY;
  if (!url || !key) throw new Error("SCOREPLAY_API_URL and SCOREPLAY_API_KEY must be set in .env.local");
  return { url, key };
}

async function request<T>(path: string, init?: { method: "POST"; body: unknown }): Promise<T> {
  const { url, key } = config();
  const response = await fetch(`${url}${path}`, {
    method: init?.method ?? "GET",
    headers: { "X-ScorePlay-Api-Key": key, ...(init ? { "Content-Type": "application/json" } : {}) },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) throw new Error(`ScorePlay ${response.status} on ${path}: ${await response.text()}`);
  return (await response.json()) as T;
}

export async function getMedia(id: number): Promise<SpMediaRecord> {
  return (await cached(`scoreplay/media-${id}.json`, () => request<SpMediaRecord>(`/media/${id}`))).value;
}

export async function listPlayers(): Promise<SpPlayerRecord[]> {
  return (await cached("scoreplay/players.json", () => request<SpPlayerRecord[]>("/players"))).value;
}

/** Every media item in the given events, following next_cursor until a page comes back short. */
export async function searchEventMedia(eventIds: number[]): Promise<SearchPage["media"]> {
  const name = `scoreplay/search-${[...eventIds].sort().join("-")}.json`;
  const { value } = await cached(name, async () => {
    const limit = 100;
    const all: SearchPage["media"] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await request<SearchPage>("/media/search", {
        method: "POST",
        body: { limit, event_ids: eventIds, ...(cursor ? { cursor } : {}) },
      });
      all.push(...page.media.map(({ ID, name, event_id }) => ({ ID, name, event_id })));
      if (page.media.length < limit || !page.next_cursor) return all;
      cursor = page.next_cursor;
    }
  });
  return value;
}

/** The English subtitle text attached to a media item, or undefined when it has none. */
export async function englishSubtitles(media: SpMediaRecord): Promise<string | undefined> {
  const attachment = media.attachments?.find((a) => a.name === "english_subtitle.srt");
  if (!attachment) return undefined;
  const { value } = await cached(`scoreplay/subtitles-${media.ID}.json`, async () => {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`Subtitle fetch ${response.status} for media ${media.ID}`);
    return { text: await response.text() };
  });
  return value.text;
}

/** Live upload receipt; deliberately bypasses the analysis cache. */
export async function getPublishedMedia(id: number) {
  return request<{
    ID: number;
    name: string;
    event_id: number;
    status: string;
    video?: { duration: number; file_size: string; width: number; height: number };
  }>(`/media/${id}`);
}
