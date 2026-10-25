import type { Moment, MomentKind, Segment, Signal } from "./types";

/** One search result before it is merged into a moment. */
export type Hit = Segment & {
  videoId: string;
  kind: MomentKind;
  label: string;
  signal: Signal;
  thumbnailUrl?: string;
};

/** Hits closer than this many seconds are treated as the same moment. */
const JOIN_GAP = 3;
/** A moment never grows past this, so one long hit cannot swallow a half. */
const MAX_SPAN = 45;

export function overlap(a: { start: number; end: number }, b: { start: number; end: number }) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/**
 * Combines independent signals so that two weak hits on the same moment
 * outrank one weak hit, without any total going past 1.
 */
export function combineStrengths(strengths: number[]) {
  return 1 - strengths.reduce((miss, s) => miss * (1 - Math.min(1, Math.max(0, s))), 1);
}

/** Groups hits on the same video that touch or overlap into moments. */
export function clusterHits(hits: Hit[]): Moment[] {
  const byVideo = new Map<string, Hit[]>();
  for (const hit of hits) {
    const list = byVideo.get(hit.videoId) ?? [];
    list.push(hit);
    byVideo.set(hit.videoId, list);
  }

  const moments: Moment[] = [];
  for (const list of byVideo.values()) {
    list.sort((a, b) => a.start - b.start || b.end - a.end);
    let group: Hit[] = [];
    let groupEnd = -Infinity;
    const flush = () => {
      if (group.length) moments.push(toMoment(group));
      group = [];
      groupEnd = -Infinity;
    };
    for (const hit of list) {
      const groupStart = group[0]?.start ?? hit.start;
      const joins = hit.start <= groupEnd + JOIN_GAP && Math.max(groupEnd, hit.end) - groupStart <= MAX_SPAN;
      if (group.length && !joins) flush();
      group.push(hit);
      groupEnd = Math.max(groupEnd, hit.end);
    }
    flush();
  }
  return moments.sort((a, b) => b.score - a.score);
}

function toMoment(group: Hit[]): Moment {
  const strongest = (list: Hit[]) => list.reduce((a, b) => (b.signal.strength > a.signal.strength ? b : a));
  const best = strongest(group);
  // A fan post says something happened but not what; let a typed hit name it.
  const typed = group.filter((h) => h.kind !== "other");
  const namer = typed.length ? strongest(typed) : best;
  const signals = dedupeSignals(group.map((h) => h.signal));
  const start = Math.min(...group.map((h) => h.start));
  const end = Math.max(...group.map((h) => h.end));
  return {
    id: `m-${best.videoId.slice(-6)}-${Math.round(start * 10)}`,
    kind: namer.kind,
    title: namer.label,
    primary: { assetId: best.assetId, videoId: best.videoId, start, end },
    angles: [],
    signals,
    thumbnailUrl: best.thumbnailUrl,
    score: combineStrengths(signals.map((s) => s.strength)),
  };
}

/** Keeps the strongest signal per source and query. */
function dedupeSignals(signals: Signal[]): Signal[] {
  const best = new Map<string, Signal>();
  for (const s of signals) {
    const key = `${s.source}|${s.query ?? s.label}`;
    const prev = best.get(key);
    if (!prev || s.strength > prev.strength) best.set(key, s);
  }
  return [...best.values()].sort((a, b) => b.strength - a.strength);
}

/** `HH:MM:SS` for anything an hour or longer, `MM:SS` otherwise. */
export function formatTimecode(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Trims or pads a segment to `length` seconds around its middle, inside [0, duration]. */
export function fitSegment(seg: Segment, length: number, duration = Infinity): Segment {
  const mid = (seg.start + seg.end) / 2;
  let start = mid - length / 2;
  let end = mid + length / 2;
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > duration) {
    start = Math.max(0, start - (end - duration));
    end = duration;
  }
  return { ...seg, start: round1(start), end: round1(end) };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
