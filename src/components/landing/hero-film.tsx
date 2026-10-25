"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { CheckIcon, PauseIcon, PhotoIcon, PlayIcon, ReplayIcon, VideoIcon } from "./icons";
import { proposals, spikes, timelinePosition } from "./sample-match";
import { WindowFrame } from "./window-chrome";

// The hero plays Rundown on one match as four stages. Each stage is a scene of CSS animations with their
// own delays (landing.css, the f-* classes); this component only decides which scene is on screen, restarts
// it, and pauses it. Pausing sets animation-play-state on the whole film, so the scene, the fill behind the
// current step and the timer below stop together. A still shows a scene's last frame by switching animation off.
const STAGES = [
  {
    label: "Pull the match",
    duration: 4600,
    status:
      "Step 1 of 4, pull the match. Rundown lists every asset ScorePlay holds for the game and streams each one by URL.",
  },
  {
    label: "Find the moments",
    duration: 6800,
    status:
      "Step 2 of 4, find the moments. Twelve Labs Marengo scans every camera for moments, and Pegasus describes what each one shows.",
  },
  {
    label: "Draft for each audience",
    duration: 5800,
    status:
      "Step 3 of 4, draft for each audience. Rundown drafts five proposals, each with an audience, a format and a reason, and sets two moments aside with the reason.",
  },
  {
    label: "Approve and write back",
    duration: 6200,
    status:
      "Step 4 of 4, approve and write back. A producer approves the first proposal, and Rundown writes it onto the ScorePlay asset as tags and a timecoded action.",
  },
];
// With reduced motion, Play shows each stage's last frame in turn and holds it this long.
const STILL_HOLD = 2600;
const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

const delay = (ms: number, extra?: Record<string, string>) => ({ "--d": `${ms}ms`, ...extra }) as CSSProperties;

function subscribeReducedMotion(onChange: () => void) {
  const query = matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

// False on the server and during hydration. Until then the first scene plays on its own, so the page
// still shows the film without JavaScript.
const noSubscription = () => () => {};
function useHydrated() {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

const chip = "rounded-full bg-fill px-2 py-0.5 text-caption font-semibold";

const assets = [
  { name: "Broadcast", kind: "video", length: "1:50:00" },
  { name: "ISO camera behind the goal", kind: "video", length: "1:50:00" },
  { name: "Bench camera", kind: "video", length: "1:52:30" },
  { name: "Press conference", kind: "video", length: "0:24:10" },
  { name: "Match photos", kind: "photo", length: "Photos" },
];

function PullScene() {
  return (
    <div className="absolute inset-0 flex flex-col p-4 sm:p-5">
      <div className="f-rise flex items-end justify-between gap-3" style={delay(0)}>
        <div className="min-w-0">
          <p className="text-caption text-secondary">ScorePlay library</p>
          <p className="truncate text-body font-semibold">Tottenham Hotspur v Manchester United</p>
        </div>
        <span className={`${chip} shrink-0`}>5 assets</span>
      </div>
      <ul className="mt-4 rounded-2xl bg-card">
        {assets.map((asset, i) => {
          const at = 350 + i * 420;
          return (
            <li
              key={asset.name}
              className="f-rise flex items-center gap-3 px-4 py-3"
              style={delay(at)}
            >
              {asset.kind === "video" ? (
                <VideoIcon className="size-5 shrink-0 text-secondary" />
              ) : (
                <PhotoIcon className="size-5 shrink-0 text-secondary" />
              )}
              <p className="min-w-0 flex-1 truncate text-subhead font-semibold">{asset.name}</p>
              <span className="timecode text-caption text-secondary">{asset.length}</span>
              <span className="f-pie grid size-5 shrink-0 place-items-center rounded-full text-white" style={delay(at + 150, { "--dur": "800ms" })}>
                <span className="f-pop" style={delay(at + 950)}>
                  <CheckIcon className="size-3" />
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="f-rise mt-auto text-caption text-secondary" style={delay(2900)}>
        Streamed by URL. Rundown keeps IDs, timecodes and metadata, never the footage.
      </p>
    </div>
  );
}

// Abstract film strips in alternating bands: a pitch, the stands, the bench, a camera that only rolls
// after the match.
const FRAME_LINES = "repeating-linear-gradient(90deg, rgb(0 0 0 / 0.1) 0 18px, transparent 18px 36px)";
const lanes = [
  { name: "Broadcast", strip: `${FRAME_LINES}, linear-gradient(90deg, #3f7a4b, #4c8c57 40%, #3a7046 70%, #44824f)`, ids: ["partner", "red-card", "replay"] },
  { name: "ISO", strip: `${FRAME_LINES}, linear-gradient(90deg, #6c5468, #8a6a72 45%, #5d4a63)`, ids: ["equaliser"] },
  { name: "Bench", strip: `${FRAME_LINES}, linear-gradient(90deg, #4f6072, #5f7286 50%, #4a5b6c)`, ids: ["red-card", "full-time"] },
  { name: "Photos", strip: `${FRAME_LINES}, linear-gradient(90deg, #9b8a73, #b39f84 50%, #8e7e69)`, ids: ["crowd"] },
  { name: "Press", strip: `linear-gradient(90deg, var(--fill) 0 92%, #c9c5bd 92%)`, ids: ["presser"] },
];
const moments = [...proposals, ...spikes];
const tcOf = (id: string) => moments.find((m) => m.id === id)?.tc ?? "00:00:00";
const SWEEP_AT = 700;
const SWEEP = 3200;

function WatchScene() {
  const equaliser = proposals[0];
  return (
    <div className="absolute inset-0 flex flex-col p-4 sm:p-5">
      <div className="f-rise flex items-end justify-between gap-3" style={delay(0)}>
        <div>
          <p className="text-caption text-secondary">Twelve Labs Marengo</p>
          <p className="text-body font-semibold">Searching every camera</p>
        </div>
        <span className="timecode text-caption text-secondary">00:00:00 to post-match</span>
      </div>
      <div className="relative mt-4 rounded-2xl bg-card px-3 py-2.5 sm:px-4">
        {lanes.map((lane, i) => (
          <div key={lane.name} className="f-rise flex items-center gap-3 py-1" style={delay(120 + i * 70)}>
            <span className="w-14 shrink-0 text-caption text-secondary">{lane.name}</span>
            <div className="relative h-6 flex-1 rounded-[5px]" style={{ background: lane.strip }}>
              {lane.ids.map((id) => {
                const left = timelinePosition(tcOf(id));
                return (
                  <span
                    key={id}
                    className="f-pop absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgb(0_0_0/0.45)]"
                    style={{ left: `${left}%`, "--d": `${SWEEP_AT + (left / 100) * SWEEP}ms` } as CSSProperties}
                  />
                );
              })}
            </div>
          </div>
        ))}
        <div className="pointer-events-none absolute inset-y-2.5 left-20 right-3 sm:left-[5.25rem] sm:right-4">
          <span
            className="f-sweep playhead absolute inset-y-0"
            style={delay(SWEEP_AT, { "--dur": `${SWEEP}ms` })}
          />
        </div>
      </div>
      <div className="f-rise mt-4 rounded-2xl bg-card p-4" style={delay(4200)}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={chip}>Pegasus</span>
          <span className="timecode text-caption text-secondary">
            {equaliser.tc} · {equaliser.source}
          </span>
        </div>
        <p className="mt-2 text-subhead font-semibold">Home end on its feet as the equaliser goes in.</p>
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {["Crowd", "Celebration", "Home end", "Goal"].map((tag, i) => (
            <li key={tag} className={`f-pop ${chip}`} style={delay(4700 + i * 140)}>
              {tag}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ProposeScene() {
  return (
    <div className="absolute inset-0 flex flex-col p-4 sm:p-5">
      <div className="f-rise flex items-end justify-between gap-3" style={delay(0)}>
        <div>
          <p className="text-caption text-secondary">Rundown</p>
          <p className="text-body font-semibold">Running order</p>
        </div>
        <span className={chip}>5 proposed · 2 set aside</span>
      </div>
      <ol className="mt-3 rounded-2xl bg-card">
        {proposals.map((p, i) => (
          <li
            key={p.id}
            className="f-rise flex items-center gap-2.5 px-4 py-2.5"
            style={delay(250 + i * 360)}
          >
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-tally" />
            <span className="timecode w-14 shrink-0 text-caption text-secondary">{p.tc}</span>
            <span className="min-w-0 flex-1 truncate text-subhead font-semibold">{p.moment}</span>
            <span className={`f-pop hidden shrink-0 sm:inline ${chip}`} style={delay(450 + i * 360)}>
              {p.audience}
            </span>
          </li>
        ))}
      </ol>
      <p className="f-rise mt-3 px-1 text-caption font-semibold uppercase tracking-[0.04em] text-secondary" style={delay(2300)}>
        Set aside, with the reason
      </p>
      <ol className="mt-1.5 rounded-2xl bg-card">
        {spikes.map((s, i) => (
          <li
            key={s.id}
            className="f-rise px-4 py-2.5"
            style={delay(2500 + i * 380)}
          >
            <p className="flex items-center gap-2.5 text-subhead font-semibold text-secondary">
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-separator" />
              <span className="dim truncate" style={delay(2900 + i * 380)}>
                {s.moment}
              </span>
            </p>
            <p className="f-rise mt-0.5 truncate pl-[18px] text-caption" style={delay(3150 + i * 380)}>
              {s.reason}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

const APPROVED_AT = 2050;

function DecideScene() {
  // The window has room for four rows above the write-back card, so the last proposal stays off screen.
  const [first, ...rest] = proposals.slice(0, 4);
  return (
    <div className="absolute inset-0 flex flex-col p-4 sm:p-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-caption text-secondary">Producer review</p>
          <p className="text-body font-semibold">Running order</p>
        </div>
        <span className="grid justify-items-end text-right text-footnote font-semibold [&>*]:[grid-area:1/1]">
          <span className="f-gone inline-flex items-center gap-1.5" style={delay(APPROVED_AT)}>
            <span aria-hidden className="size-2 rounded-full bg-tally" />5 waiting
          </span>
          <span className="f-pop inline-flex items-center gap-1.5" style={delay(APPROVED_AT)}>
            <span aria-hidden className="size-2 rounded-full bg-tally" />4 waiting · 1 approved
          </span>
        </span>
      </div>
      <ol className="mt-3 rounded-2xl bg-card">
        <li className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="relative flex size-3.5 shrink-0 items-center justify-center">
              <span className="f-gone size-2 rounded-full bg-tally" style={delay(APPROVED_AT)} />
              <span className="f-pop absolute inset-0 text-go" style={delay(APPROVED_AT)}>
                <CheckIcon className="size-3.5" />
              </span>
            </span>
            <span className="timecode w-14 shrink-0 text-caption text-secondary">{first.tc}</span>
            <span className="min-w-0 flex-1 truncate text-subhead font-semibold">{first.moment}</span>
          </div>
          <div className="relative mt-2.5 flex h-8 items-center gap-2 pl-6">
            <span className="f-gone flex gap-2" style={delay(APPROVED_AT)}>
              <span className="relative inline-flex h-8 items-center rounded-full bg-tint-fill px-3.5 text-footnote font-semibold text-tint">
                Approve
                <span className="f-ripple absolute inset-0 rounded-full bg-tint" style={delay(1700)} />
                <span className="f-cursor absolute left-1/2 top-1/2" style={delay(300)}>
                  <svg aria-hidden viewBox="0 0 20 20" className="size-5 drop-shadow-[0_1px_2px_rgb(0_0_0/0.35)]">
                    <path d="M4 2.5v13.2l3.4-3.1 2.3 5 2.4-1.1-2.3-4.9 4.7-.4z" fill="#fff" stroke="#000" strokeWidth={1.1} strokeLinejoin="round" />
                  </svg>
                </span>
              </span>
              <span className="inline-flex h-8 items-center rounded-full bg-fill px-3.5 text-footnote font-semibold">Spike</span>
            </span>
            <span className="f-pop absolute left-6 inline-flex items-center gap-1 text-footnote font-semibold text-go" style={delay(APPROVED_AT)}>
              <CheckIcon className="size-4" />
              Approved
            </span>
          </div>
        </li>
        {rest.map((p, i) => (
          <li key={p.id} className={`flex items-center gap-2.5 px-4 py-2.5 ${i === rest.length - 1 ? "max-[359px]:hidden" : ""}`}>
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-tally" />
            <span className="timecode w-14 shrink-0 text-caption text-secondary">{p.tc}</span>
            <span className="min-w-0 flex-1 truncate text-subhead font-semibold">{p.moment}</span>
          </li>
        ))}
      </ol>
      <div className="f-rise mt-auto rounded-2xl bg-label p-4 text-page shadow-[0_20px_40px_-20px_rgb(0_0_0/0.5)]" style={delay(2800)}>
        <p className="flex items-center gap-2 text-subhead font-semibold">
          <CheckIcon className="size-4" />
          Written to ScorePlay
        </p>
        <p className="timecode mt-1 text-caption opacity-75">
          {first.source} · {first.tc} to 00:17:56
        </p>
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {["rundown-approved", "rundown-audience-season-ticket", "rundown-format-9x16-reaction"].map((tag, i) => (
            <li
              key={tag}
              className="f-pop timecode max-w-full truncate rounded-full bg-page/15 px-2 py-0.5 text-caption"
              style={delay(3200 + i * 150)}
            >
              {tag}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const SCENES = [PullScene, WatchScene, ProposeScene, DecideScene];

type Insets = [number, number, number, number];
const round = ([top, right, bottom, left]: Insets) => `inset(${top}px ${right}px ${bottom}px ${left}px round 16px)`;
function insets(clip: string): Insets | null {
  const values = (clip.split("round")[0].match(/-?[\d.]+px/g) ?? []).map(parseFloat);
  if (!values.length) return null;
  const [top, right = top, bottom = top, left = right] = values;
  return [top, right, bottom, left];
}

export function HeroFilm({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const hydrated = useHydrated();
  const [stage, setStage] = useState(0);
  // Bumped to restart the current scene's animations from the top.
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  // A still shows the scene's last frame. A step picked from the keyboard shows one, and so does every
  // stage when reduced motion is on.
  const [picked, setPicked] = useState(false);
  // One step picked, rather than the whole walkthrough.
  const [single, setSingle] = useState(false);
  const still = picked || reduced;

  const elapsed = useRef(0);
  const startedAt = useRef(0);
  const playingRef = useRef(false);
  const visible = useRef(false);
  const autoplayed = useRef(false);
  // Set when the film paused because it left the screen or the tab, so it resumes on its own when it returns.
  const pausedAway = useRef(false);
  const screen = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const steps = useRef<(HTMLLIElement | null)[]>([]);
  const indicatorAt = useRef(-1);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // The stage timer. Pausing banks the time played so far, so Play picks up where the scene stopped.
  useEffect(() => {
    if (!playing) return;
    const length = still ? STILL_HOLD : STAGES[stage].duration;
    startedAt.current = performance.now();
    const timer = window.setTimeout(
      () => {
        elapsed.current = 0;
        if (!single && stage < STAGES.length - 1) {
          setStage(stage + 1);
          setRun((n) => n + 1);
        } else {
          setPlaying(false);
          setFinished(true);
        }
      },
      Math.max(0, length - elapsed.current),
    );
    return () => window.clearTimeout(timer);
  }, [playing, stage, run, still, single]);

  const pause = useCallback(() => {
    if (!playingRef.current) return;
    elapsed.current += performance.now() - startedAt.current;
    setPlaying(false);
  }, []);

  const play = () => {
    autoplayed.current = true;
    pausedAway.current = false;
    if (finished) {
      elapsed.current = 0;
      setFinished(false);
      setRun((n) => n + 1);
      if (!single) setStage(0);
    } else if (picked && !reduced) {
      elapsed.current = 0;
      setPicked(false);
      setRun((n) => n + 1);
    }
    setPlaying(true);
  };

  // A pointer choice plays that step in full. A keyboard choice, or a window scrolled out of view, shows
  // the step's last frame at once.
  const select = (position: number, animate: boolean) => {
    const willPlay = animate && !reduced && visible.current;
    autoplayed.current = true;
    pausedAway.current = false;
    elapsed.current = 0;
    setStage(position);
    setSingle(true);
    setFinished(false);
    setRun((n) => n + 1);
    setPicked(!willPlay);
    setPlaying(willPlay);
  };

  const watchAll = () => {
    autoplayed.current = true;
    elapsed.current = 0;
    setSingle(false);
    setStage(0);
    setFinished(false);
    setPicked(false);
    setRun((n) => n + 1);
    setPlaying(true);
  };

  // Play the first time half the window is on screen. Leaving the screen or the tab pauses the film, and
  // coming back picks up where it stopped.
  useEffect(() => {
    const node = screen.current;
    if (!node) return;
    const pauseAway = () => {
      if (!playingRef.current) return;
      pausedAway.current = true;
      pause();
    };
    const resumeIfAway = () => {
      if (!pausedAway.current || !visible.current || document.hidden) return;
      pausedAway.current = false;
      setPlaying(true);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible.current = entry.isIntersecting && entry.intersectionRatio >= 0.5;
        if (!visible.current) {
          pauseAway();
          return;
        }
        if (!autoplayed.current && !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
          autoplayed.current = true;
          setPlaying(true);
          return;
        }
        resumeIfAway();
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(node);
    const onHidden = () => {
      if (document.hidden) pauseAway();
      else resumeIfAway();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [pause]);

  // The highlight behind the current step. Moving between steps it first stretches over both, then lets go
  // of the old one, so it travels as one shape instead of jumping.
  const moveIndicator = useCallback(
    (instant: boolean) => {
      const shape = indicator.current;
      const item = steps.current[stage];
      if (!shape || !item) return;
      const target: Insets = [
        item.offsetTop,
        shape.clientWidth - item.offsetLeft - item.offsetWidth,
        shape.clientHeight - item.offsetTop - item.offsetHeight,
        item.offsetLeft,
      ];
      const from = insets(getComputedStyle(shape).clipPath);
      shape.getAnimations().forEach((animation) => animation.cancel());
      shape.style.clipPath = round(target);
      if (!instant && !reduced && from && indicatorAt.current !== -1 && indicatorAt.current !== stage) {
        const bridge = target.map((value, side) => Math.min(value, from[side])) as Insets;
        shape.animate(
          [
            { clipPath: round(from), easing: EASE },
            { clipPath: round(bridge), offset: 0.45, easing: EASE },
            { clipPath: round(target) },
          ],
          { duration: 420 },
        );
      }
      indicatorAt.current = stage;
    },
    [stage, reduced],
  );

  useLayoutEffect(() => moveIndicator(false), [moveIndicator]);

  // A resize, such as text wrapping differently, snaps the highlight into place. The watcher is set up once
  // and ignores callbacks where the size didn't change, including the one it fires on setup, which would
  // otherwise cancel the morph in progress.
  const snapIndicator = useRef(moveIndicator);
  useLayoutEffect(() => {
    snapIndicator.current = moveIndicator;
  }, [moveIndicator]);
  useEffect(() => {
    const shape = indicator.current;
    if (!shape) return;
    let size = `${shape.clientWidth}x${shape.clientHeight}`;
    const observer = new ResizeObserver(() => {
      const next = `${shape.clientWidth}x${shape.clientHeight}`;
      if (next === size) return;
      size = next;
      snapIndicator.current(true);
    });
    observer.observe(shape);
    return () => observer.disconnect();
  }, []);

  const Scene = SCENES[stage];
  const control = playing ? "pause" : finished ? "replay" : "play";
  const label = { pause: "Pause", replay: single ? "Replay step" : "Replay", play: single ? "Play step" : "Play" }[control];

  return (
    <div
      data-paused={hydrated && !playing ? "" : undefined}
      data-still={still ? "" : undefined}
      className="film grid gap-x-16 gap-y-10 [grid-template-areas:'copy'_'screen'_'steps'] lg:grid-cols-2 lg:[grid-template-areas:'copy_screen'_'steps_screen'] lg:items-start"
    >
      <div className="[grid-area:copy] lg:pt-6">{children}</div>

      <figure className="[grid-area:screen] lg:sticky lg:top-24" aria-label="Illustrated walkthrough of Rundown on one match">
        <div ref={screen}>
          <WindowFrame title="Rundown">
            <div aria-hidden className="relative h-[470px] overflow-hidden sm:h-[440px]">
              <Scene key={`${stage}-${run}`} />
            </div>
          </WindowFrame>
        </div>
        <figcaption className="sr-only" aria-live="polite">
          {STAGES[stage].status}
        </figcaption>
      </figure>

      <div className="[grid-area:steps] lg:max-w-[440px]">
        <div className="relative">
          <span
            ref={indicator}
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-2xl bg-fill [clip-path:inset(0_0_100%_0_round_16px)]"
          />
          <ol className="relative grid" aria-label="Walkthrough steps">
            {STAGES.map((step, i) => {
              const current = i === stage;
              const done = !single && i < stage;
              return (
                <li
                  key={step.label}
                  ref={(element) => {
                    steps.current[i] = element;
                  }}
                >
                  <button
                    type="button"
                    onClick={(event) => select(i, event.detail > 0)}
                    aria-current={current ? "step" : undefined}
                    className="press relative isolate grid min-h-14 w-full grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3.5 overflow-hidden rounded-2xl px-3.5 py-2.5 text-left"
                  >
                    {current ? (
                      <span aria-hidden className="absolute inset-0 -z-10">
                        <span
                          key={run}
                          className="f-wash block h-full"
                          style={{ "--dur": `${step.duration}ms` } as CSSProperties}
                        />
                      </span>
                    ) : null}
                    <span
                      className={`grid size-7 place-items-center rounded-full text-footnote font-semibold transition-colors ${current || done ? "bg-label text-page" : "bg-fill text-secondary"}`}
                    >
                      {i + 1}
                    </span>
                    <span className={`text-body font-semibold transition-colors ${current ? "" : "text-secondary"}`}>
                      {step.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <button
            type="button"
            onClick={control === "pause" ? pause : play}
            className="press inline-flex h-11 items-center gap-2 rounded-full bg-fill px-5 text-[15px] font-semibold hover:bg-[color-mix(in_srgb,var(--fill),var(--label)_8%)]"
          >
            {control === "pause" ? <PauseIcon /> : control === "replay" ? <ReplayIcon /> : <PlayIcon />}
            {label}
          </button>
          {single ? (
            <button type="button" onClick={watchAll} className="press h-11 rounded-full px-3 text-[15px] text-tint hover:bg-tint-fill">
              Watch all
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
