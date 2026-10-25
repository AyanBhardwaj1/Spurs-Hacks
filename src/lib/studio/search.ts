import "server-only";
import { search } from "@/lib/twelvelabs";
import { READ_TIMEOUT_MS, ServiceTimeout } from "./slow";

// Plain-language search over the full match with Twelve Labs Marengo. The match is indexed as this video
// in TWELVELABS_INDEX_ID; the ID is the pipeline's (TWELVE_LABS_VIDEO_ID in scripts/studio/visual.ts), and
// its seconds are source seconds, so hits go straight onto the timeline.
const MATCH_VIDEO_ID = "6adb019e5beb2f1510570778";
const MAX_SEARCHES = 2;
let activeSearches = 0;

export type SearchHit = { start: number; end: number; rank: number; thumbnailUrl?: string };

export type SearchResult = { hits: SearchHit[] } & (
  | { source: "live" }
  | { source: "recorded"; matchedQuery: string; reason: "allowance" | "timeout" | "network" }
);

export class SearchBusy extends Error {
  constructor() {
    super("Twelve Labs search is busy, try again");
  }
}

export async function searchMatch(query: string, limit = 10, signal?: AbortSignal): Promise<SearchHit[]> {
  if (activeSearches >= MAX_SEARCHES) throw new SearchBusy();
  activeSearches += 1;
  const timeoutController = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
  const timeout = setTimeout(
    () => timeoutController.abort(new ServiceTimeout("Twelve Labs", "the search", READ_TIMEOUT_MS)),
    READ_TIMEOUT_MS,
  );
  try {
    const clips = await search({ query, videoIds: [MATCH_VIDEO_ID], modalities: ["visual", "audio"], limit, signal: requestSignal });
    return clips
      .filter((c) => c.video_id === MATCH_VIDEO_ID)
      .sort((a, b) => a.rank - b.rank)
      .map((c) => ({ start: c.start, end: c.end, rank: c.rank, thumbnailUrl: c.thumbnail_url }));
  } finally {
    clearTimeout(timeout);
    activeSearches -= 1;
  }
}
