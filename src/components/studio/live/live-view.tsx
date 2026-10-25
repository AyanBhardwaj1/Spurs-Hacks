"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { crossedPeaks, MATCH_ANCHORS, MAX_PLAYBACK_STEP_SEC, matchPhase, scorebug, sourceAtDate, sourceSecond } from "@/lib/studio/live";
import { clipLength, timecode } from "@/lib/studio/time";
import type { ClipFormat, MatchAnalysis, Moment } from "@/lib/studio/types";
import { studioContainer } from "../studio-bar";
import { CrowdMeter } from "./crowd-meter";
import { LivePlayer, type PlayerPosition } from "./live-player";
import { MomentCard } from "./moment-card";
import { ReplayDialog } from "./replay-dialog";
import { useClipStreams, useLiveSignal, useNow, useSimulatedStart } from "./use-live";

export type LiveMoment = Omit<Moment, "focus" | "description">;

export type LiveClip = {
  id: string;
  variant: string;
  format: ClipFormat;
  title: string;
  durationSec: number;
  scoreplayMediaId: number;
  momentIds: string[];
};

type Props = {
  source: { id: number; title: string; previewUrl: string; durationSec: number };
  moments: LiveMoment[];
  clips: LiveClip[];
  crowd: MatchAnalysis["crowd"];
};

type FeedEntry = {
  moment: LiveMoment;
  /** Wall-clock ms the feed passed it, or undefined for moments that aired before the page opened. */
  passedAt?: number;
};

/** Moments from before the page opened that the feed starts with. */
const EARLIER = 3;
const FEED_MAX = 12;
/** Moments offered for replay: the highest-scoring ones. */
const GOOD_BITS = 6;

export function LiveView({ source, moments, clips, crowd }: Props) {
  const signal = useLiveSignal();
  const { streams, error: streamsError } = useClipStreams();
  const now = useNow();
  const simAt = useSimulatedStart();

  const [muted, setMuted] = useState(true);
  const [position, setPosition] = useState<number>();
  const [playingSeq, setPlayingSeq] = useState<number>();
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string>();
  const [playingClipId, setPlayingClipId] = useState<string>();
  const [replay, setReplay] = useState<LiveMoment>();
  const [announcement, setAnnouncement] = useState("");
  const mutedBeforeReplay = useRef(true);
  const last = useRef<number | undefined>(undefined);
  const playlist = useRef(signal.playlist);
  const simulated = useRef(simAt !== undefined);

  useEffect(() => {
    playlist.current = signal.playlist;
  }, [signal.playlist]);

  const advance = useCallback(
    (sec: number) => {
      setPosition(sec);
      const prev = last.current;
      last.current = sec;
      // Opening the page mid-match, or the loop starting over: the last few moments the feed already
      // passed lead the list.
      if (prev === undefined || sec < prev - MAX_PLAYBACK_STEP_SEC) {
        const earlier = moments.filter((m) => m.peak <= sec).slice(-EARLIER).reverse();
        setFeed(earlier.map((moment) => ({ moment })));
        return;
      }
      const crossed = crossedPeaks(prev, sec, moments);
      if (crossed.length === 0) return;
      const at = Date.now();
      setFeed((f) => [...crossed.reverse().map((moment) => ({ moment, passedAt: at })), ...f].slice(0, FEED_MAX));
      setExpandedId(undefined);
      const newest = crossed[0];
      setAnnouncement(`The feed passed a moment from the analysis: ${newest.matchClock ?? ""} ${newest.title}`);
    },
    [moments],
  );

  const onPosition = useCallback(
    (p: PlayerPosition) => {
      if (p.kind === "fragment") setPlayingSeq(p.seq);
      if (simulated.current) return;
      const sec = p.kind === "fragment" ? sourceSecond(p.n, p.offsetSec) : sourceAtDate(p.dateMs, playlist.current);
      if (sec !== undefined) advance(sec);
    },
    [advance],
  );

  // Development only: ?at= drives the position from a timer instead of the feed.
  useEffect(() => {
    simulated.current = simAt !== undefined;
    if (simAt === undefined) return;
    last.current = undefined;
    const t0 = performance.now();
    const id = setInterval(() => advance(simAt + (performance.now() - t0) / 1000), 250);
    return () => clearInterval(id);
  }, [simAt, advance]);

  const goodBits = useMemo(
    () => [...moments].sort((a, b) => b.scores.total - a.scores.total).slice(0, GOOD_BITS).sort((a, b) => a.peak - b.peak),
    [moments],
  );
  const next = position === undefined ? undefined : moments.find((m) => m.peak > position);
  const clipsFor = (id: string) => clips.filter((c) => c.momentIds.includes(id));
  const latestId = feed[0]?.moment.id;

  const openReplay = (m: LiveMoment) => {
    mutedBeforeReplay.current = muted;
    setMuted(true);
    setPlayingClipId(undefined);
    setReplay(m);
  };
  const closeReplay = () => {
    setReplay(undefined);
    setMuted(mutedBeforeReplay.current);
  };

  return (
    <main className={`${studioContainer} pb-24 pt-6`}>
      {simAt !== undefined && (
        <p role="status" className="mb-4 rounded-xl border border-dashed border-tally px-4 py-2 text-footnote text-tally">
          Development override: the position is simulated from source second {simAt} (<code>?at={simAt}</code>), not read from the feed. The video and the
          crowd meter are still the real feed.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <LivePlayer muted={muted} onMutedChange={setMuted} onPosition={onPosition} />
          <Scoreboard position={position} durationSec={source.durationSec} moments={moments} />
          <CrowdMeter readings={signal.readings} playingSeq={simAt === undefined ? playingSeq : undefined} crowd={crowd} moments={moments} error={signal.error} unavailable={signal.unavailable} lastOkAt={signal.lastOkAt} now={now} />
        </div>

        <aside aria-labelledby="feed-title" className="flex min-w-0 flex-col rounded-[18px] bg-grouped">
          <div className="px-5 pt-4">
            <p className="text-caption font-semibold uppercase tracking-[0.06em] text-secondary">From Rundown&rsquo;s analysis</p>
            <h2 id="feed-title" className="mt-1 text-title3 font-semibold">
              Moments as the feed passes them
            </h2>
            <p className="mt-1 text-caption text-secondary text-pretty">
              The feed replays the match Rundown analysed, so each moment the analysis found appears when the feed reaches its peak second. They were
              found before the feed started, from commentary, crowd audio and Twelve Labs.
            </p>
          </div>
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
          <ol className="mt-3 flex-1 space-y-2 px-3 pb-3">
            {feed.length === 0 && (
              <li className="rounded-[14px] p-3 text-footnote text-secondary">
                {position === undefined ? "Waiting for the feed to start playing." : "No moments yet in this part of the match."}
              </li>
            )}
            {feed.map(({ moment, passedAt }) => (
              <li key={`${moment.id}-${passedAt ?? "earlier"}`}>
                <MomentCard
                  moment={moment}
                  when={passedAt === undefined ? "Before you opened this" : `${Math.max(0, Math.round((now - passedAt) / 1000))} s ago on the feed`}
                  expanded={moment.id === latestId || moment.id === expandedId}
                  fresh={passedAt !== undefined && now - passedAt < 4000}
                  clips={clipsFor(moment.id)}
                  streams={streams}
                  streamsError={streamsError}
                  playingClipId={replay ? undefined : playingClipId}
                  onPlayClip={setPlayingClipId}
                  onExpand={() => setExpandedId(moment.id)}
                />
              </li>
            ))}
          </ol>
          {next && position !== undefined && (
            <p className="border-t border-separator/50 px-5 py-3 text-caption text-secondary">
              Next in the analysis: <span className="text-label">{next.matchClock ?? timecode(next.peak)} {next.title}</span>
              <span className="num"> · in {clipLength(next.peak - position)}</span>
            </p>
          )}
        </aside>
      </div>

      <section aria-labelledby="bits-title" className="mt-8">
        <p className="text-caption font-semibold uppercase tracking-[0.06em] text-secondary">Replay</p>
        <h2 id="bits-title" className="mt-1 text-title3 font-semibold">
          Jump to a good bit
        </h2>
        <p className="mt-1 max-w-[70ch] text-caption text-secondary">
          A live feed cannot rewind. These play ScorePlay&rsquo;s full-match recording from just before the moment, to show what the feed looked like there.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {goodBits.map((m) => (
            <button key={m.id} type="button" onClick={() => openReplay(m)} className="live-bit press">
              <span className="num text-title3 font-semibold">{m.matchClock}</span>
              <span className="min-w-0 text-left">
                <span className="block truncate text-footnote font-semibold">{m.title}</span>
                <span className="num block text-caption text-secondary">
                  Score {Math.round(m.scores.total * 100)} · {clipsFor(m.id).length > 0 ? `${clipsFor(m.id).length} ASAP clips` : "no clips"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {replay && (
        <ReplayDialog
          moment={replay}
          moments={moments}
          previewUrl={source.previewUrl}
          clips={clips}
          streams={streams}
          streamsError={streamsError}
          onClose={closeReplay}
        />
      )}
    </main>
  );
}

const PHASE_LINE: Record<ReturnType<typeof matchPhase>, (t: number, durationSec: number) => string> = {
  "Pre-match": (t) => `Kick-off in ${clipLength(MATCH_ANCHORS.firstHalfKickoff - t)}`,
  "First half": () => "First half",
  "Half-time": (t) => `Second half in ${clipLength(MATCH_ANCHORS.secondHalfKickoff - t)}`,
  "Second half": () => "Second half",
  "After full time": (t, d) => `Full time · the loop restarts in ${clipLength(d - t)}`,
};

function Scoreboard({ position, durationSec, moments }: { position?: number; durationSec: number; moments: LiveMoment[] }) {
  const at = (t: number) => `${(Math.min(durationSec, Math.max(0, t)) / durationSec) * 100}%`;
  const bug = position === undefined ? undefined : scorebug(position);
  const phase = position === undefined ? undefined : matchPhase(position);

  return (
    <section aria-label="Where the feed is in the match" className="rounded-[18px] bg-grouped p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <p className="live-bug num" aria-live="off">
          {bug ?? (
            <span className="text-secondary">{phase ?? "––:––"}</span>
          )}
        </p>
        <div className="min-w-0 pb-1">
          <p className="text-footnote font-semibold">
            {position === undefined || !phase ? "Waiting for the feed" : PHASE_LINE[phase](position, durationSec)}
          </p>
          <p className="num text-caption text-secondary">
            {position === undefined
              ? "The clock follows the segment on screen"
              : `${timecode(position)} of ${timecode(durationSec)} into the match recording · segment ${Math.floor(position / 2)}`}
          </p>
        </div>
      </div>
      <div className="live-strip mt-4" aria-hidden>
        <i className="live-strip-half" style={{ left: at(MATCH_ANCHORS.firstHalfKickoff), right: `calc(100% - ${at(MATCH_ANCHORS.halfTime)})` }} />
        <i className="live-strip-half" style={{ left: at(MATCH_ANCHORS.secondHalfKickoff), right: `calc(100% - ${at(MATCH_ANCHORS.fullTime)})` }} />
        {moments.map((m) => (
          <i
            key={m.id}
            className="live-strip-pin"
            data-passed={position !== undefined && m.peak <= position ? "" : undefined}
            style={{ left: at(m.peak), height: `${30 + m.scores.total * 70}%` }}
          />
        ))}
        {position !== undefined && <i className="live-strip-head" style={{ left: at(position) }} />}
      </div>
      <div className="relative mt-1.5 h-4 text-caption text-secondary" aria-hidden>
        <span className="absolute" style={{ left: at(MATCH_ANCHORS.firstHalfKickoff) }}>
          Kick-off
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: at(MATCH_ANCHORS.halfTime) }}>
          Half-time
        </span>
        <span className="absolute -translate-x-full" style={{ left: at(MATCH_ANCHORS.fullTime) }}>
          Full time
        </span>
      </div>
    </section>
  );
}
