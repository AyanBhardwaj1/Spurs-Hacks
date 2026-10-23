import { TwelveLabsError, twelvelabsConfigured } from "@/lib/twelvelabs";
import { SearchBusy, searchMatch, type SearchResult } from "@/lib/studio/search";
import { loadStudioAnalysis } from "@/lib/studio/load";
import { matchMoments } from "@/lib/studio/search-moments";
import { matchRecordedSearch } from "@/lib/studio/search-recorded";
import { ServiceTimeout } from "@/lib/studio/slow";

type RecordedReason = Extract<SearchResult, { source: "recorded" }>["reason"];

function recordedFallbackReason(err: unknown): RecordedReason | null {
  if (err instanceof TwelveLabsError) {
    if (err.status === 422 && /workload allowance.*exhausted/i.test(err.message)) return "allowance";
    if (err.status === 408 || err.status === 504) return "timeout";
    return null;
  }
  if (err instanceof ServiceTimeout || (err instanceof Error && err.name === "TimeoutError")) return "timeout";
  if (err instanceof TypeError && /fetch|network|connect/i.test(err.message)) return "network";
  return null;
}

// When Twelve Labs fails, recorded pipeline hits answer known match searches, and the run's own moments
// answer the rest.
export async function GET(request: Request) {
  if (!twelvelabsConfigured()) return Response.json({ error: "No Twelve Labs key on the server." }, { status: 503 });
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 80) return Response.json({ error: "Search for 2 to 80 characters." }, { status: 400 });
  try {
    return Response.json({ source: "live", hits: await searchMatch(q, 10, request.signal) });
  } catch (err) {
    const reason = recordedFallbackReason(err);
    if (reason && !request.signal.aborted) {
      const recorded = matchRecordedSearch(q);
      if (recorded) return Response.json({ source: "recorded", reason, matchedQuery: recorded.query, hits: recorded.hits.slice(0, 10) });
      const analysis = loadStudioAnalysis();
      const own = matchMoments(q, analysis.moments, analysis.source.players);
      if (own.length > 0) return Response.json({ source: "moments", reason, hits: own });
    }
    if (err instanceof SearchBusy) return Response.json({ error: err.message }, { status: 503 });
    if (err instanceof ServiceTimeout) return Response.json({ slow: true });
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Twelve Labs refused the search: ${message}` }, { status: 502 });
  }
}
