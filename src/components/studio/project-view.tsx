"use client";

import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { indexAnalysis, momentGroups, seenOnCamera, usesMatchWatch, writtenMomentIds } from "@/lib/studio/clips";
import { clubCheck } from "@/lib/studio/evaluation";
import type { SourceExtras } from "@/lib/studio/library";
import { mediaTitle, stageTime } from "@/lib/studio/time";
import type { MatchAnalysis } from "@/lib/studio/types";
import { AccuracyPanel } from "./accuracy-panel";
import { ClipBoard, type ClipView } from "./clip-board";
import { Dropped } from "./dropped";
import { TimelineSearch, type Found } from "./timeline-search";
import { WrittenBack } from "./written-back";
import { AUDIENCE_LABEL } from "./bits";
import { ExtrasProvider, NO_FOOTAGE_COPY, ScorePlayNote } from "./extras";
import { ReviewStoreProvider } from "./review-store";
import { MatchTimeline } from "./match-timeline";
import { MomentInspector } from "./moment-inspector";
import { DEMO_STEPS, PresentButton, PresenterBar, sectionFor, spotlight, stepFromUrl, writeStepToUrl, type DemoStepId } from "./presenter";
import { Published, pairKey } from "./published";
import { RecapPlayer } from "./recap-player";
import { reelKey, withReelEdit } from "./reel-studio";
import { RunRail } from "./run-rail";
import { StorageVerdict } from "./storage-verdict";
import { useMediaFailed } from "./use-media-failed";
import { useReducedMotion } from "./use-reduced-motion";

/** "a, b and c" */
const listOf = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

type Props = {
  analysis: MatchAnalysis;
  recordedAt: string;
  extras: Promise<SourceExtras>;
};


// One video plays at a time: a clip preview, the recap, or the source monitor. Starting one stops the others.
export function ProjectView({ analysis, recordedAt, extras }: Props) {
  const { source, moments, groundTruth } = analysis;
  const { momentsById, ranked, matches, recap, published } = useMemo(() => indexAnalysis(analysis), [analysis]);
  const ordered = useMemo(() => [...moments].sort((a, b) => a.peak - b.peak), [moments]);
  const clubEditCounts = useMemo(
    () => new Map([...matches].map(([id, ranges]) => [id, new Set(ranges.map((r) => r.scoreplayId)).size])),
    [matches],
  );
  const reduced = useReducedMotion();
  const rejected = analysis.rejected;
  const [found, setFound] = useState<Found | null>(null);
  const writtenIds = useMemo(() => writtenMomentIds(analysis), [analysis]);

  const [selectedId, setSelectedId] = useState(() => [...moments].sort((a, b) => b.scores.total - a.scores.total)[0]?.id);
  const [activeClip, setActiveClip] = useState<string | null>(null);
  const [recapPlaying, setRecapPlaying] = useState(false);
  const [clipView, setClipView] = useState<ClipView>("moment");
  const sourceRef = useRef<HTMLVideoElement>(null);
  const monitorFailed = useMediaFailed(sourceRef);
  const inspectorRef = useRef<HTMLDivElement>(null);

  const selected = selectedId ? momentsById.get(selectedId) : undefined;

  // Cue the monitor to the top moment, so the first frame on screen is worth looking at. The element may
  // have loaded its metadata before hydration, so this checks rather than waiting for the event.
  const cueAt = useRef(selected?.start);
  useEffect(() => {
    const v = sourceRef.current;
    const at = cueAt.current;
    if (!v || at === undefined) return;
    const cue = () => {
      if (v.currentTime === 0 && v.paused) v.currentTime = at;
    };
    if (v.readyState >= HTMLMediaElement.HAVE_METADATA) cue();
    else v.addEventListener("loadedmetadata", cue, { once: true });
    return () => v.removeEventListener("loadedmetadata", cue);
  }, []);
  const scrollBehavior = reduced ? "auto" : "smooth";

  const seek = useCallback(
    (t: number, play: boolean, scroll = true) => {
      const v = sourceRef.current;
      if (!v) return;
      v.currentTime = t;
      if (play) {
        setActiveClip(null);
        setRecapPlaying(false);
        v.play().catch((err: DOMException) => {
          if (err.name !== "AbortError") console.error("The source monitor did not play:", err);
        });
      }
      const box = v.getBoundingClientRect();
      if (scroll && (box.bottom < 120 || box.top > window.innerHeight - 120)) {
        v.scrollIntoView({ behavior: scrollBehavior, block: "center" });
      }
    },
    [scrollBehavior],
  );

  const activate = useCallback((id: string) => {
    setActiveClip(id);
    setRecapPlaying(false);
    sourceRef.current?.pause();
  }, []);
  const release = useCallback((id: string) => setActiveClip((cur) => (cur === id ? null : cur)), []);

  // ---------- The demo path (steps 2 to 6; step 1 is the library) ----------
  const router = useRouter();
  const [present, setPresent] = useState<number | null>(null);
  // Remounting the pipeline rail replays it, so the run step always starts from its first stage.
  const [runKey, setRunKey] = useState(0);

  const notes = useMemo(() => {
    const { groups } = momentGroups(ranked, momentsById);
    const variants = groups.reduce((n, g) => n + g.clips.length, 0);
    const audiences = [...new Set(ranked.flatMap((c) => (c.audience ? [AUDIENCE_LABEL[c.audience].toLowerCase()] : [])))];
    const check = clubCheck(analysis.eval);
    const reel = withReelEdit(ranked);
    const total = analysis.stages.reduce((n, s) => n + s.durationMs, 0);
    const written = analysis.writeback ? ` It wrote ${analysis.writeback.videoLogs} timecoded moments back onto the match in ScorePlay.` : "";
    return {
      library: "",
      run: `${analysis.stages.length} stages that took ${stageTime(total)} on the recorded run, replayed here sped up. Each card shows what its stage did and how long it really took.`,
      match: `${moments.length} moments, found from the commentary and the crowd's noise; Twelve Labs saw ${moments.filter(seenOnCamera).length} of them on camera. Green marks are where Tottenham's editors cut.${written}`,
      dropped:
        rejected.length > 0
          ? `${rejected.length} candidates it weighed and dropped, each with a reason a producer can argue with, so the gem it missed is one click away.`
          : "This run did not record what it dropped; the list arrives with the next run.",
      clips: `Claude planned ${ranked.length} edits${groups.length > 0 ? `, ${variants} of them for the top ${groups.length} moments` : ""}${
        audiences.length > 0 ? `, cut for ${listOf(audiences)}` : ""
      }. Every one plays straight from the source, reframed on the action.${
        reel.length > 0 ? ` ${reel.length === 1 ? "One headline clip was" : `${reel.length} headline clips were`} finished in Reel Studio; both versions are in ScorePlay.` : ""
      }`,
      accuracy: `${check.head.hits} of our top ${check.head.k} moments overlap clips Tottenham's team made by hand. Same-length picks at random: about ${check.head.random}.`,
      published: `The system proposes, a person approves: Approve or Reject writes the decision onto the clip in ScorePlay. ${published.length} clips are rendered and uploaded next to the match.`,
    } satisfies Record<DemoStepId, string>;
  }, [analysis, moments, momentsById, published.length, ranked, rejected.length]);

  const goStep = useCallback(
    (n: number) => {
      if (n === 0) {
        spotlight(null);
        router.push("/studio?present=1");
        return;
      }
      const id = DEMO_STEPS[n].id;
      setPresent(n);
      writeStepToUrl(n);
      spotlight(id);
      setActiveClip(null);
      setRecapPlaying(false);
      sourceRef.current?.pause();
      sectionFor(id)?.scrollIntoView({ behavior: scrollBehavior, block: "start" });
      if (id === "run") setRunKey((k) => k + 1);
      if (id === "match") {
        const top = [...moments].sort((a, b) => b.scores.total - a.scores.total)[0];
        if (top) {
          setSelectedId(top.id);
          seek(top.start, true, false);
        }
      }
      if (id === "clips") {
        setClipView("moment");
        // The Reel Studio edits lead the step when the run has them: they are the most finished cut.
        const reel = withReelEdit(ranked)[0];
        if (reel) setActiveClip(reelKey(reel.clip.id));
        else if (ranked[0]) setActiveClip(ranked[0].id);
      }
      if (id === "published" && published[0]) setActiveClip(pairKey(published[0].id));
    },
    [moments, published, ranked, router, scrollBehavior, seek],
  );

  const exitPresent = useCallback(() => {
    setPresent(null);
    writeStepToUrl(null);
    spotlight(null);
  }, []);

  // Next hides this page instead of unmounting it when the presenter goes back to the library, and a hidden
  // video keeps streaming; pause every video here when the page hides.
  const pageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = pageRef.current;
    return () => root?.querySelectorAll("video").forEach((v) => v.pause());
  }, []);

  // Arriving with ?present=N (from the library, or a reload mid-demo) resumes that step once the page has
  // laid out. Step 1 belongs to the library, so it starts at the run here.
  useEffect(() => {
    const n = stepFromUrl();
    const id = n === null ? undefined : setTimeout(() => goStep(Math.max(1, n)), 300);
    return () => {
      clearTimeout(id);
      spotlight(null);
    };
    // Only on arrival; later steps come from the presenter itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showMoment = useCallback(
    (id: string) => {
      setSelectedId(id);
      inspectorRef.current?.scrollIntoView({ behavior: scrollBehavior, block: "nearest" });
    },
    [scrollBehavior],
  );

  // Every clip has a card in both arrangements, so the card is already in the document.
  const showClip = (id: string) => {
    const card = document.getElementById(`clip-${id}`);
    if (!card) return;
    card.scrollIntoView({ behavior: scrollBehavior, block: "center" });
    card.removeAttribute("data-flash");
    void card.offsetWidth;
    card.setAttribute("data-flash", "");
    card.querySelector<HTMLButtonElement>("button[aria-pressed]")?.focus({ preventScroll: true });
  };

  return (
    <ExtrasProvider value={extras}>
      <ReviewStoreProvider>
        <div ref={pageRef} className="contents">
          <div id="run" data-section="run" className="scroll-mt-24">
            <RunRail key={runKey} stages={analysis.stages} recordedAt={recordedAt} matchWatch={usesMatchWatch(moments)} />
          </div>

          <section id="match" data-section="match" aria-label="Match" className="mt-6 scroll-mt-20">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(380px,1fr)]">
              <div className="relative aspect-video min-w-0 overflow-hidden rounded-[14px] bg-[var(--monitor)]">
                <video
                  ref={sourceRef}
                  src={source.previewUrl}
                  controls
                  muted
                  playsInline
                  preload="metadata"
                  aria-label={`Source: ${mediaTitle(source.name)}`}
                  className="absolute inset-0 size-full"
                  onPlay={() => {
                    setActiveClip(null);
                    setRecapPlaying(false);
                  }}
                />
                {monitorFailed && (
                  <p role="status" className="absolute inset-0 grid place-items-center bg-[var(--monitor)] p-6 text-center text-footnote text-secondary text-pretty">
                    {NO_FOOTAGE_COPY}
                  </p>
                )}
              </div>
              <div ref={inspectorRef} className="min-h-[420px] scroll-mt-24 xl:relative">
                <div className="xl:absolute xl:inset-0">
                  {selected ? (
                    <MomentInspector
                      moment={selected}
                    written={writtenIds.has(selected.id)}
                      ordered={ordered}
                      roster={source.players}
                      clubClips={matches.get(selected.id) ?? []}
                      clips={ranked.filter((c) => c.segments.some((s) => s.momentId === selected.id))}
                      onSelect={setSelectedId}
                      onSeek={seek}
                      onShowClip={showClip}
                    />
                  ) : (
                    <p className="rounded-[18px] bg-grouped p-5 text-footnote text-secondary">This run found no moments.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-5">
            <TimelineSearch found={found} onFound={setFound} onSeek={seek} frameSource={source.previewUrl} />
          </div>
          {analysis.writeback && <WrittenBack writeback={analysis.writeback} sourceId={source.id} />}
          <ScorePlayNote part="posters" className="mt-3" />
            <div className="mt-6">
              <MatchTimeline
                durationSec={source.durationSec}
                crowd={analysis.crowd}
                moments={ordered}
                groundTruth={groundTruth}
                dropped={rejected}
              searchHits={found?.hits}
                searchSource={found?.source}
                selectedId={selectedId}
                videoRef={sourceRef}
                onSelectMoment={setSelectedId}
                onSeek={seek}
              />
            </div>
          </section>

          <div id="dropped" data-section="dropped" className="band mt-12 scroll-mt-24 pt-10">
            <Dropped rejected={rejected} momentsById={momentsById} onOpenMoment={setSelectedId} onSeek={seek} />
            <StorageVerdict analysis={analysis} onSeek={seek} />
          </div>

          <div id="clips" data-section="clips" className="band mt-12 scroll-mt-24 pt-10">
            <ClipBoard
              ranked={ranked}
              momentsById={momentsById}
              clubEditCounts={clubEditCounts}
              roster={source.players}
              src={source.previewUrl}
              view={clipView}
              onView={setClipView}
              activeClip={activeClip}
              onActive={activate}
              onRelease={release}
              onShowMoment={showMoment}
            />
          </div>

          <div id="accuracy" data-section="accuracy" className="band mt-14 scroll-mt-24 pt-10">
            <AccuracyPanel
              evaluation={analysis.eval}
              groundTruth={groundTruth}
              moments={moments}
              momentsById={momentsById}
              durationSec={source.durationSec}
              onSelectMoment={showMoment}
              onSeek={seek}
            />
          </div>

          {recap && (
            <div id="recap" className="band mt-14 scroll-mt-24 pt-10">
              <RecapPlayer
                clip={recap}
                momentsById={momentsById}
                src={source.previewUrl}
                playing={recapPlaying}
                onPlayingChange={(on) => {
                  setRecapPlaying(on);
                  if (on) {
                    setActiveClip(null);
                    sourceRef.current?.pause();
                  }
                }}
              />
            </div>
          )}

          {published.length > 0 && (
            <div id="published" data-section="published" className="band mt-14 scroll-mt-24 pt-10">
              <Suspense fallback={<p className="text-footnote text-secondary">Loading the uploaded clips from ScorePlay…</p>}>
                <Published
                  clips={published}
                  momentsById={momentsById}
                  src={source.previewUrl}
                  activeId={activeClip}
                  onActive={activate}
                  onRelease={release}
                />
              </Suspense>
            </div>
          )}
        </div>

        {/* Room below the last section while presenting, so every step can scroll its section to the top. */}
        {present !== null && <div aria-hidden className="h-[60vh]" />}

        {present === null ? (
          <PresentButton onStart={() => goStep(1)} />
        ) : (
          <PresenterBar step={present} note={notes[DEMO_STEPS[present].id]} onGo={goStep} onExit={exitPresent} />
        )}
      </ReviewStoreProvider>
    </ExtrasProvider>
  );
}
