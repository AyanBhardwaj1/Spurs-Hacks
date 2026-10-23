"use client";
/* eslint-disable @next/next/no-img-element -- Thumbnails come from Twelve Labs' CDN; next/image would need remotePatterns in next.config.ts, which the studio does not own. */

import { useId, useState } from "react";
import type { SearchHit, SearchResult } from "@/lib/studio/search";
import { timecode } from "@/lib/studio/time";
import { CameraIcon } from "./bits";

export type Found = { query: string } & SearchResult;

type Props = {
  found: Found | null;
  onFound: (found: Found | null) => void;
  onSeek: (t: number, play: boolean) => void;
  /** The match's ScorePlay rendition, for a frame where a result has no thumbnail. */
  frameSource: string;
};

const EXAMPLES = ["red card, players surround referee", "striker heads cross into far corner", "players celebrating equaliser"];

// Plain-language search over the full match with Twelve Labs. Results land on the timeline as pins and
// here as thumbnails; either plays that moment in the monitor.
export function TimelineSearch({ found, onFound, onSeek, frameSource }: Props) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"idle" | "searching" | "slow" | "error">("idle");
  const [error, setError] = useState("");

  async function run(q: string) {
    const text = q.trim();
    if (text.length < 2 || state === "searching") return;
    setQuery(text);
    setState("searching");
    try {
      const res = await fetch(`/api/studio/search?q=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(8000) });
      const body = (await res.json()) as SearchResult | { slow: true } | { error: string };
      if ("slow" in body) {
        setState("slow");
        return;
      }
      if (!res.ok || !("hits" in body)) throw new Error("error" in body ? body.error : `The server answered ${res.status}.`);
      onFound({ query: text, ...body });
      setState("idle");
    } catch (err) {
      const e = err as Error;
      setError(e.name === "TimeoutError" ? "The studio server did not answer." : e.message);
      setState("error");
    }
  }

  return (
    <div className="rounded-[14px] bg-grouped px-4 py-3">
      <form
        role="search"
        className="flex flex-wrap items-center gap-x-3 gap-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
      >
        <label htmlFor={inputId} className="flex shrink-0 items-center gap-1.5 text-caption font-semibold text-tint">
          <CameraIcon className="size-3.5" />
          Twelve Labs search
        </label>
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the match in plain words"
          maxLength={80}
          className="h-9 min-w-[220px] flex-1 rounded-lg bg-fill px-3 text-footnote text-label placeholder:text-secondary/70"
        />
        <button
          type="submit"
          disabled={state === "searching" || query.trim().length < 2}
          className="press inline-flex h-9 items-center rounded-full bg-button px-4 text-footnote font-semibold text-white hover:bg-button-hover disabled:opacity-40"
        >
          {state === "searching" ? "Searching…" : "Search"}
        </button>
        <span className="flex flex-wrap items-center gap-1.5 text-caption text-secondary">
          Try
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={state === "searching"}
              onClick={() => run(ex)}
              className="press h-7 rounded-full border border-separator px-2.5 font-semibold text-label hover:bg-fill disabled:opacity-40"
            >
              {ex}
            </button>
          ))}
          {found && (
            <button type="button" disabled={state === "searching"} onClick={() => onFound(null)} className="press h-7 rounded-md px-1.5 font-semibold text-tint hover:underline disabled:opacity-40">
              Clear
            </button>
          )}
        </span>
      </form>

      {state === "slow" && (
        <p role="status" className="mt-2 text-caption text-secondary">
          Twelve Labs is slow; try again in a moment. The run&rsquo;s own moments are still on the timeline.
        </p>
      )}
      {state === "error" && (
        <p role="alert" className="mt-2 text-caption text-tally">
          {error}
        </p>
      )}

      {found && (
        <div className="mt-3" aria-live="polite">
          {found.source === "recorded" && (
            <p className="mb-1 text-caption text-secondary">
              Recorded Twelve Labs results for &ldquo;{found.matchedQuery}&rdquo; ({found.reason === "allowance" ? "live search allowance used up" : found.reason === "timeout" ? "live search timed out" : "live search connection failed"})
            </p>
          )}
          {found.source === "moments" && (
            <p className="mb-1 text-caption text-secondary">
              Live Twelve Labs search {found.reason === "allowance" ? "allowance used up" : found.reason === "timeout" ? "timed out" : "connection failed"}; these are moments from this run whose title, commentary or Pegasus description mention it.
            </p>
          )}
          <p className="text-caption text-secondary">
            {found.hits.length === 0 ? (
              <>Twelve Labs found nothing for &ldquo;{found.query}&rdquo;.</>
            ) : (
              <>
                {found.hits.length} {found.hits.length === 1 ? "place" : "places"} {found.source === "recorded" ? "in the recorded search" : found.source === "moments" ? "among the run’s moments" : "Twelve Labs found"} for &ldquo;
                <span className="text-label">{found.query}</span>&rdquo;, best first. White pins mark them on the timeline.
              </>
            )}
          </p>
          {found.hits.length > 0 && (
            <Results key={found.hits.map((h) => `${h.rank}@${h.start}`).join(",")} hits={found.hits} onSeek={onSeek} frameSource={frameSource} />
          )}
        </div>
      )}
    </div>
  );
}

// Recorded results carry no thumbnail, because Twelve Labs' thumbnail links expire, so each shows the
// match's own frame at its start. The frames load one after another: each seeks into the full-match
// rendition, and ten at once would compete with the monitor for the connection. The parent keys this by
// the hit list, so every new list starts its own queue.
function Results({ hits, onSeek, frameSource }: { hits: SearchHit[]; onSeek: Props["onSeek"]; frameSource: string }) {
  const [loaded, setLoaded] = useState(0);
  const next = (i: number) => setLoaded((n) => Math.max(n, i + 1));
  // Position of each frameless hit among the frameless ones; hits with a thumbnail don't wait their turn.
  const order = hits.map((h, i) => (h.thumbnailUrl ? -1 : hits.slice(0, i).filter((x) => !x.thumbnailUrl).length));

  return (
    <ol className="mt-2 flex gap-2 overflow-x-auto pb-1">
      {hits.map((h, i) => {
        const frame = order[i];
        return (
          <li key={`${h.start}-${h.rank}`} className="shrink-0">
            <button
              type="button"
              onClick={() => onSeek(h.start, true)}
              aria-label={`Play result ${h.rank} at ${timecode(h.start)}`}
              className="press group block w-[136px] text-left"
            >
              <span className="relative block aspect-video overflow-hidden rounded-md bg-card">
                {h.thumbnailUrl ? (
                  <img src={h.thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
                ) : (
                  frame <= loaded && (
                    <video
                      src={`${frameSource}#t=${h.start}`}
                      muted
                      playsInline
                      preload="metadata"
                      aria-hidden
                      tabIndex={-1}
                      onLoadedData={(e) => {
                        e.currentTarget.dataset.ready = "";
                        next(frame);
                      }}
                      // A browser may stop at metadata under preload="metadata" and never fire loadeddata;
                      // suspend says it stopped fetching, so the next frame doesn't wait forever.
                      onSuspend={() => next(frame)}
                      onError={() => next(frame)}
                      className="pointer-events-none absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-200 data-ready:opacity-100 motion-reduce:transition-none"
                    />
                  )
                )}
                <span className="chip chip-film num absolute left-1 top-1">{h.rank}</span>
              </span>
              <span className="num mt-1 block text-caption text-tint group-hover:underline">{timecode(h.start)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
