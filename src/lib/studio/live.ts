// Where ScorePlay's live feed is in the analysed match. The feed is an HLS loop of the full match
// (media 130852725): segment video_NNNNNN.ts covers source seconds [2N, 2N + 2). That mapping was checked
// on 23 October by measuring the crowd floor of 22 feed segments against the analysed proxy rendition at
// 2N; the two differ by 0.24 dB on average, and the Mbeumo goal's roar lands in segments 2333 to 2340.

import type { ClockAnchors } from "../../../scripts/studio/clock";
import type { Moment } from "./types";

export const LIVE_PLAYLIST_URL = "https://aoitcvzxerocd4mckn7hcis7eu0iivfh.lambda-url.us-east-1.on.aws/live.m3u8";
export const SEGMENT_SEC = 2;

/**
 * The whistles of media 130852725 on the broadcast's own clock. The kickoffs were read off the on-screen
 * scorebug in the full-match rendition on 23 October: 12:39 at 1,000 s and 29:19 at 2,000 s put the first
 * kickoff at 241 s; 60:53 at 4,000 s, 77:33 at 5,000 s and 92:33 at 5,900 s put the second at 3,047 s.
 * The analysis took its kickoffs from commentary lines (276.8 s and 3,062.9 s), which run 36 s and 16 s
 * behind that scorebug, so the live clock does not use them. Half-time and full time are the analysis'
 * commentary whistles (.media/studio/claude/clock-anchors-706768f070ac4365.json); the scorebug does not show them.
 */
export const MATCH_ANCHORS: ClockAnchors = {
  firstHalfKickoff: 241,
  halfTime: 2995.4,
  secondHalfKickoff: 3047,
  fullTime: 6261.3,
};

export type FeedSegment = {
  /** EXT-X-MEDIA-SEQUENCE position. Grows by one per segment for as long as the feed runs, across loops. */
  seq: number;
  /** N in video_NNNNNN.ts, so the segment starts at source second 2N. */
  n: number;
  url: string;
  /** EXT-X-PROGRAM-DATE-TIME in epoch milliseconds: when this segment airs on the feed's clock. */
  airsAt: number;
  durationSec: number;
};

/** The only host the server fetches feed segments from. */
export const FEED_SEGMENT_HOST = "cdn.scoreplay.io";

/**
 * True for an https URL on ScorePlay's CDN. The server fetches whatever the playlist lists, so anything
 * else, such as an internal address, is refused before a request is made.
 */
export function isFeedSegmentUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === FEED_SEGMENT_HOST && u.port === "" && u.username === "" && u.password === "";
  } catch {
    return false;
  }
}

/** N from a segment URL such as ".../hls/video_000787.ts". Throws on anything else, since every number downstream depends on it. */
export function segmentNumber(url: string): number {
  const match = /video_(\d+)\.ts(?:$|\?)/.exec(url);
  if (!match) throw new Error(`Not a ScorePlay feed segment URL: ${url}`);
  return Number(match[1]);
}

/** The URL of segment `n`, built from any other segment's URL in the same feed. */
export function segmentUrl(sample: string, n: number): string {
  segmentNumber(sample);
  return sample.replace(/video_\d+\.ts/, `video_${String(n).padStart(6, "0")}.ts`);
}

/** Source second at `offsetSec` into segment `n`. */
export function sourceSecond(n: number, offsetSec = 0): number {
  return n * SEGMENT_SEC + Math.min(SEGMENT_SEC, Math.max(0, offsetSec));
}

/** Reads a live media playlist. Every segment must carry a program date time and a video_N.ts URL. */
export function parsePlaylist(text: string): FeedSegment[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== "#EXTM3U") throw new Error("The live playlist does not start with #EXTM3U");
  const seqLine = lines.find((l) => l.startsWith("#EXT-X-MEDIA-SEQUENCE:"));
  if (!seqLine) throw new Error("The live playlist has no #EXT-X-MEDIA-SEQUENCE");
  let seq = Number(seqLine.split(":")[1]);
  const out: FeedSegment[] = [];
  let airsAt: number | undefined;
  let durationSec: number | undefined;
  for (const line of lines) {
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
      airsAt = Date.parse(line.slice("#EXT-X-PROGRAM-DATE-TIME:".length));
      if (Number.isNaN(airsAt)) throw new Error(`Unreadable program date time: ${line}`);
    } else if (line.startsWith("#EXTINF:")) {
      durationSec = Number.parseFloat(line.slice("#EXTINF:".length));
    } else if (line && !line.startsWith("#")) {
      if (airsAt === undefined) throw new Error(`Segment ${line} has no #EXT-X-PROGRAM-DATE-TIME`);
      out.push({ seq, n: segmentNumber(line), url: line, airsAt, durationSec: durationSec ?? SEGMENT_SEC });
      seq += 1;
      airsAt = undefined;
      durationSec = undefined;
    }
  }
  return out;
}

/**
 * Source second for a moment on the feed's clock, for players that report a program date (native HLS in
 * Safari) instead of the fragment they are in. Undefined when the date falls outside the given segments.
 */
export function sourceAtDate(dateMs: number, segments: FeedSegment[]): number | undefined {
  const seg = segments.find((s) => dateMs >= s.airsAt && dateMs < s.airsAt + s.durationSec * 1000);
  return seg && sourceSecond(seg.n, (dateMs - seg.airsAt) / 1000);
}

export type MatchPhase = "Pre-match" | "First half" | "Half-time" | "Second half" | "After full time";

export function matchPhase(t: number, anchors: ClockAnchors = MATCH_ANCHORS): MatchPhase {
  if (t < anchors.firstHalfKickoff) return "Pre-match";
  if (t < anchors.halfTime) return "First half";
  if (t < anchors.secondHalfKickoff) return "Half-time";
  if (t <= anchors.fullTime) return "Second half";
  return "After full time";
}

/**
 * The running clock the broadcast scorebug shows at source second `t`, such as "71:14". The second half
 * starts at 45:00 and the clock runs on through added time ("92:33"), as this broadcast's does. Undefined
 * outside play.
 */
export function scorebug(t: number, anchors: ClockAnchors = MATCH_ANCHORS): string | undefined {
  const played =
    t >= anchors.firstHalfKickoff && t < anchors.halfTime
      ? t - anchors.firstHalfKickoff
      : t >= anchors.secondHalfKickoff && t <= anchors.fullTime
        ? 45 * 60 + t - anchors.secondHalfKickoff
        : undefined;
  if (played === undefined) return undefined;
  const s = Math.floor(played);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The largest step between two position readings that still counts as playback. A bigger step is a
 * reconnect, a stall catching up or the loop wrapping, and passing a moment that way is not "seeing" it.
 */
export const MAX_PLAYBACK_STEP_SEC = 10;

/** Moments whose peak the feed passed between two position readings, in the order they aired. */
export function crossedPeaks<M extends Pick<Moment, "peak">>(prev: number, next: number, moments: M[]): M[] {
  if (!(next > prev) || next - prev > MAX_PLAYBACK_STEP_SEC) return [];
  return moments.filter((m) => m.peak > prev && m.peak <= next).sort((a, b) => a.peak - b.peak);
}

/** Where each uploaded ASAP clip streams from, by ScorePlay media ID, as /api/studio/live/clips answers. */
export type LiveClipStreams = Record<number, { url: string; thumbnailUrl?: string }>;
