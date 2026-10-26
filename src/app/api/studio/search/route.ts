import { TwelveLabsError, twelvelabsConfigured } from "@/lib/twelvelabs";
import { SearchBusy, searchMatch, type FallbackReason, type SearchResult } from "@/lib/studio/search";
import { loadStudioAnalysis } from "@/lib/studio/load";
import { matchMoments } from "@/lib/studio/search-moments";
import { matchRecordedSearch } from "@/lib/studio/search-recorded";
import { ServiceTimeout } from "@/lib/studio/slow";

function recordedFallbackReason(err: unknown): Exclude<FallbackReason, "no-key"> | null {
  if (err instanceof TwelveLabsError) {
    if (err.status === 422 && /workload allowance.*exhausted/i.test(err.message)) return "allowance";
    if (err.status === 408 || err.status === 504) return "timeout";
    return null;
  }
  if (err instanceof ServiceTimeout || (err instanceof Error && err.name === "TimeoutError")) return "timeout";
  if (err instanceof TypeError && /fetch|network|connect/i.test(err.message)) return "network";
  return null;
}

// Recorded pipeline hits answer known match searches, and the run's own moments answer the rest, both when
// Twelve Labs fails and when the server has no key at all.
function offlineAnswer(q: string, reason: FallbackReason): SearchResult | null {
  const recorded = matchRecordedSearch(q);
  if (recorded) return { source: "recorded", reason, matchedQuery: recorded.query, hits: recorded.hits.slice(0, 10) };
  const analysis = loadStudioAnalysis();
  const own = matchMoments(q, analysis.moments, analysis.source.players);
  return own.length > 0 ? { source: "moments", reason, hits: own } : null;
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 80) return Response.json({ error: "Search for 2 to 80 characters." }, { status: 400 });
  // With no key, nothing matching is an empty answer: the search worked, it found nothing.
  if (!twelvelabsConfigured()) return Response.json(offlineAnswer(q, "no-key") ?? { source: "moments", reason: "no-key", hits: [] });
  try {
    return Response.json({ source: "live", hits: await searchMatch(q, 10, request.signal) });
  } catch (err) {
    const reason = recordedFallbackReason(err);
    if (reason && !request.signal.aborted) {
      const answer = offlineAnswer(q, reason);
      if (answer) return Response.json(answer);
    }
    if (err instanceof SearchBusy) return Response.json({ error: err.message }, { status: 503 });
    if (err instanceof ServiceTimeout) return Response.json({ slow: true });
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Twelve Labs refused the search: ${message}` }, { status: 502 });
  }
}
