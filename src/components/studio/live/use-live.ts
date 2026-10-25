"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { FeedSegment, LiveClipStreams } from "@/lib/studio/live";
import type { LiveSignal } from "@/lib/studio/live-meter";
import { HISTORY_SEGMENTS, heldRange, withSpikes, type LiveReading, type SegmentReading } from "@/lib/studio/live-signal";

const POLL_MS = 2000;

export type SignalState = {
  readings: LiveReading[];
  playlist: FeedSegment[];
  /** Set when the server cannot run ffmpeg; the meter then says so and the rest of the page carries on. */
  unavailable?: string;
  /** Why the latest poll failed. Cleared by the next one that succeeds. */
  error?: string;
  /** Wall-clock ms of the latest poll that succeeded. */
  lastOkAt?: number;
};

/**
 * Polls the crowd meter every two seconds while the tab is visible. The server measures a few segments per
 * request and keeps nothing between requests, so this hook holds the history and runs the spike test.
 */
export function useLiveSignal(): SignalState {
  const [state, setState] = useState<SignalState>({ readings: [], playlist: [] });

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let held = new Map<number, SegmentReading>();
    // A segment that fails is asked for once more before its failure is kept as a gap.
    const retried = new Set<number>();

    async function poll() {
      if (document.visibilityState === "visible") {
        try {
          const { after, before } = heldRange([...held.values()]);
          const query = new URLSearchParams();
          if (after !== undefined) query.set("after", String(after));
          if (before !== undefined) query.set("before", String(before));
          const res = await fetch(`/api/studio/live/signal?${query}`, { cache: "no-store" });
          const body = (await res.json()) as LiveSignal | { error: string };
          if (stopped) return;
          if ("error" in body) {
            setState((s) => ({ ...s, error: body.error }));
          } else if ("unavailable" in body) {
            setState({ readings: [], playlist: body.playlist, unavailable: body.unavailable, lastOkAt: Date.now() });
          } else {
            if (after !== undefined && body.edgeSeq < after) {
              // The feed's sequence restarted, so the held numbers mean other segments now. Start again.
              held = new Map();
              retried.clear();
              setState({ readings: [], playlist: body.playlist });
              timer = setTimeout(poll, 0);
              return;
            }
            for (const r of body.readings) {
              if (r.error && !retried.has(r.seq)) retried.add(r.seq);
              else held.set(r.seq, r);
            }
            for (const seq of held.keys()) if (seq <= body.edgeSeq - HISTORY_SEGMENTS) held.delete(seq);
            setState({ readings: withSpikes([...held.values()], body.edgeSeq), playlist: body.playlist, lastOkAt: Date.now() });
          }
        } catch (err) {
          if (!stopped) setState((s) => ({ ...s, error: `The crowd meter did not answer: ${(err as Error).message}` }));
        }
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    }

    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  return state;
}

export type StreamsState = { streams: LiveClipStreams; error?: string; loaded: boolean };

/** ScorePlay rendition URLs for the uploaded ASAP clips, asked for once. */
export function useClipStreams(): StreamsState {
  const [state, setState] = useState<StreamsState>({ streams: {}, loaded: false });
  useEffect(() => {
    let stopped = false;
    fetch("/api/studio/live/clips")
      .then(async (res) => {
        const body = (await res.json()) as LiveClipStreams | { error: string };
        if (stopped) return;
        setState("error" in body ? { streams: {}, error: String(body.error), loaded: true } : { streams: body, loaded: true });
      })
      .catch((err: Error) => !stopped && setState({ streams: {}, error: err.message, loaded: true }));
    return () => {
      stopped = true;
    };
  }, []);
  return state;
}

/** Wall-clock milliseconds, refreshed every `everyMs`, for "2 s ago" labels. Zero until mounted. */
export function useNow(everyMs = 1000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

const noSubscribe = () => () => {};

/**
 * Development only: `?at=<source second>` pretends the feed is at that second, so a moment crossing can be
 * tested without waiting for the loop. Production builds ignore it.
 */
export function useSimulatedStart(): number | undefined {
  const raw = useSyncExternalStore(
    noSubscribe,
    () => (process.env.NODE_ENV === "development" ? new URLSearchParams(window.location.search).get("at") : null),
    () => null,
  );
  const at = raw === null ? undefined : Number(raw);
  return at !== undefined && Number.isFinite(at) && at >= 0 ? at : undefined;
}
