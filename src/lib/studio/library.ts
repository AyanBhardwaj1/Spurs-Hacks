import "server-only";
import { io } from "next/cache";
import { getMedia, scoreplayConfigured, searchMedia, type SpMedia } from "@/lib/scoreplay";
import { reviewOf, type Review } from "./review";
import { READ_TIMEOUT_MS, ServiceTimeout, within } from "./slow";
import { spriteSheets, type SpriteSheets } from "./sprites";

// The match's folders in ScorePlay, under "Premier League / Manchester United vs Tottenham Hotspur - Week 6",
// read from ScorePlay's event tree on 22 October. Media search returns a folder's ID but not its name, and
// src/lib/scoreplay.ts has no call that lists a folder's children, so they are listed here. The first is the
// source the studio analyses; the order of the rest is the order the library shows them in.
export const MATCH_FOLDERS = [
  { id: 1536147, name: "Full match" },
  { id: 1536143, name: "Moments" },
  { id: 1536140, name: "Highlights" },
  { id: 1536142, name: "Creative video" },
  { id: 1536139, name: "Post-match" },
  { id: 1536141, name: "Press conference" },
  { id: 1536144, name: "Dressing room" },
  { id: 1536137, name: "Pre-match" },
] as const;

export const MATCH_LABEL = "Manchester United vs Tottenham Hotspur, Premier League week 6";

const FULL_MATCH_FOLDER = MATCH_FOLDERS[0].id;

// Search results carry these fields, but SpMedia in src/lib/scoreplay.ts does not list them.
type SearchHit = SpMedia & {
  width?: number;
  height?: number;
  media_duration?: number;
  compressed_url?: string;
};

export type LibraryItem = {
  id: number;
  name: string;
  folderId: number;
  durationSec: number;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  /** ScorePlay's compressed rendition, for a muted hover preview. */
  previewUrl?: string;
};

export type MatchLibrary =
  | {
      ok: true;
      /** Everything in the full-match folder: the match itself, and any clips uploaded back next to it. */
      matchFolder: LibraryItem[];
      folders: { id: number; name: string; items: LibraryItem[] }[];
    }
  | { ok: false; error: string; slow?: true; off?: true };

function toItem(m: SearchHit): LibraryItem {
  return {
    id: m.ID,
    name: m.name,
    folderId: m.event_id ?? 0,
    // `duration` is whole seconds; `media_duration` is nanoseconds and is set when `duration` is 0.
    durationSec: m.duration || (m.media_duration ?? 0) / 1e9,
    width: m.width,
    height: m.height,
    thumbnailUrl: m.thumbnail_url,
    previewUrl: m.compressed_url || m.proxy_medium,
  };
}

// One ScorePlay round trip serves every visitor for a few minutes, so moving between pages during the demo
// does not wait on the API. A failed call is not kept.
const TTL_MS = 5 * 60_000;
let cached: { at: number; promise: Promise<MatchLibrary> } | undefined;

export async function matchLibrary(): Promise<MatchLibrary> {
  // Keeps the ScorePlay call out of the prerendered shell; the library always reflects the live account.
  await io();
  if (!scoreplayConfigured()) return { ok: false, off: true, error: "No ScorePlay key on the server." };
  if (!cached || Date.now() - cached.at >= TTL_MS) {
    const promise = fetchLibrary();
    const entry = { at: Date.now(), promise };
    cached = entry;
    // A failed listing is not kept. A slow one is: it finishes in the background for the next visit.
    void promise.then((r) => {
      if (!r.ok && cached === entry) cached = undefined;
    });
  }
  try {
    return await within(cached.promise, READ_TIMEOUT_MS, "the match listing");
  } catch (err) {
    if (err instanceof ServiceTimeout) return { ok: false, slow: true, error: err.message };
    throw err;
  }
}

async function fetchLibrary(): Promise<MatchLibrary> {
  try {
    const media = (await searchMedia(
      { media_type: "video", event_ids: MATCH_FOLDERS.map((f) => f.id), order_by: "name", order_type: "asc" },
      400,
    )) as SearchHit[];
    const items = media.map(toItem);
    return {
      ok: true,
      matchFolder: items.filter((i) => i.folderId === FULL_MATCH_FOLDER),
      folders: MATCH_FOLDERS.slice(1)
        .map((f) => ({ id: f.id, name: f.name, items: items.filter((i) => i.folderId === f.id) }))
        .filter((f) => f.items.length > 0),
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// The fields of a single media record the studio reads: the source's sprite sheets, and a rendered
// clip's rendition and thumbnail.
export type MediaWithVideo = SpMedia & {
  CreatedAt?: string;
  video?: { sprite_full?: string; thumbnail?: string; proxy_medium?: string; width?: number; height?: number; duration?: number };
};

/** A clip the pipeline rendered and uploaded back into ScorePlay, as ScorePlay now holds it. */
export type RenderedClip = {
  id: number;
  name: string;
  /** ScorePlay's compressed rendition of the uploaded file. */
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  uploadedAt?: string;
  eventId?: number;
  /** The producer's decision as ScorePlay holds it, or why it could not be read. */
  review: Review | { error: string };
};

async function renderedClip(id: number): Promise<RenderedClip> {
  const m = (await getMedia(id)) as MediaWithVideo;
  const url = m.video?.proxy_medium ?? m.proxy_medium;
  if (!url) throw new Error(`ScorePlay media ${id} has no playable rendition yet (status ${m.status ?? "unknown"})`);
  return {
    id,
    name: m.name,
    url,
    thumbnailUrl: m.video?.thumbnail ?? m.thumbnail_url,
    width: m.video?.width,
    height: m.video?.height,
    durationSec: m.video?.duration,
    uploadedAt: m.CreatedAt,
    eventId: m.event_id,
    review: await reviewOf(m).catch((err: Error) => ({ error: err.message })),
  };
}

export type SourceExtras = {
  sprites?: SpriteSheets;
  /** Thumbnails of the club's clips, by ScorePlay ID. */
  clubThumbs: Record<number, string>;
  /** Hover previews of the club's clips, by ScorePlay ID. */
  clubPreviews: Record<number, string>;
  /** Rendered clips back in ScorePlay, by ScorePlay ID. A clip missing here failed to resolve; see `error`. */
  rendered: Record<number, RenderedClip>;
  /** Parts ScorePlay did not return, and why; those sections say so quietly. */
  missing: Partial<Record<ExtrasPart, MissingReason>>;
};

/** Why a part of the page has no ScorePlay data: it was slow, it failed, or there is no key at all. */
export type MissingReason = "slow" | "failed" | "off";

export type ExtrasPart = "posters" | "club" | "uploads";

// The source's sprite sheets never change, so one lookup serves every visit, and a slow one still lands.
const sourceMedia = new Map<number, Promise<MediaWithVideo>>();
function sourceRecord(mediaId: number) {
  let record = sourceMedia.get(mediaId);
  if (!record) {
    record = getMedia(mediaId) as Promise<MediaWithVideo>;
    record.catch(() => sourceMedia.delete(mediaId));
    sourceMedia.set(mediaId, record);
  }
  return record;
}

export async function sourceExtras(mediaId: number, durationSec: number, renderedIds: number[] = []): Promise<SourceExtras> {
  await io();
  // No key, no calls: every part ScorePlay would fill says it is not connected.
  if (!scoreplayConfigured()) {
    const off = "off" as const;
    return { rendered: {}, clubThumbs: {}, clubPreviews: {}, missing: { posters: off, club: off, ...(renderedIds.length > 0 && { uploads: off }) } };
  }
  // Every call is bounded, so this settles within READ_TIMEOUT_MS whatever ScorePlay does. Decisions are
  // read fresh on each visit, so they are not cached like the source record and the listing.
  const [[media, library], renders] = await Promise.all([
    Promise.allSettled([within(sourceRecord(mediaId), READ_TIMEOUT_MS, "the source record"), matchLibrary()]),
    Promise.allSettled(renderedIds.map((id) => within(renderedClip(id), READ_TIMEOUT_MS, `upload ${id}`))),
  ]);
  const missing: SourceExtras["missing"] = {};
  const why = (reason: unknown) => (reason instanceof ServiceTimeout ? "slow" : "failed");
  if (media.status === "rejected") missing.posters = why(media.reason);
  if (library.status === "rejected") missing.club = why(library.reason);
  else if (!library.value.ok) missing.club = library.value.slow ? "slow" : "failed";
  const failedRenders = renders.filter((r) => r.status === "rejected");
  if (failedRenders.length > 0) missing.uploads = failedRenders.some((r) => r.reason instanceof ServiceTimeout) ? "slow" : "failed";
  const rendered: Record<number, RenderedClip> = {};
  const clubThumbs: Record<number, string> = {};
  const clubPreviews: Record<number, string> = {};
  const errors: string[] = [];
  if (library.status === "fulfilled" && library.value.ok) {
    for (const folder of library.value.folders) {
      for (const item of folder.items) {
        if (item.thumbnailUrl) clubThumbs[item.id] = item.thumbnailUrl;
        if (item.previewUrl) clubPreviews[item.id] = item.previewUrl;
      }
    }
  } else {
    errors.push(library.status === "rejected" ? String(library.reason) : !library.value.ok ? library.value.error : "");
  }
  if (media.status === "rejected") errors.push(String(media.reason));
  for (const r of renders) {
    if (r.status === "fulfilled") rendered[r.value.id] = r.value;
    else errors.push(String(r.reason));
  }
  // The page says only that ScorePlay is slow or did not answer; the reasons go to the server log.
  if (errors.some(Boolean)) console.warn(`[studio] ScorePlay extras for ${mediaId}: ${errors.filter(Boolean).join(" · ")}`);
  return {
    rendered,
    sprites: media.status === "fulfilled" ? spriteSheets(media.value.video?.sprite_full, durationSec) : undefined,
    clubThumbs,
    clubPreviews,
    missing,
  };
}
