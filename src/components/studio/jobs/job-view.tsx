"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import { PLACEMENTS } from "@/lib/rundown/platforms";
import { matchClock } from "@/lib/jobs/moments";
import { clipSeconds, isMontage } from "@/lib/jobs/planner";
import { postText } from "@/lib/jobs/post";
import { preflight } from "@/lib/jobs/preflight";
import { postOrder, type Strength } from "@/lib/jobs/rank";
import { SPORT } from "@/lib/jobs/sports";
import type { JobSummary } from "@/lib/jobs/summary";
import { JOB_PLACEMENTS, PLACEMENT_LABEL, type Job, type JobClip, type JobPlacement, type JobStage } from "@/lib/jobs/types";
import { EnergyTimeline } from "./energy-timeline";
import { useReviewKeys } from "./review-keys";
import { uploadFile } from "./upload";

const POLL_MS = 2000;

/** A 404: the job was deleted or never existed, so the page stops asking. */
class Gone extends Error {}
const live = (job: Job | null) => !job || job.status === "queued" || job.status === "running";

const STAGE_MARK: Record<JobStage["state"], string> = { waiting: "○", running: "◐", done: "●", skipped: "–", failed: "×" };
const length = (c: JobClip) => Math.round(clipSeconds(c));

// One uploaded match: its progress while it runs, then every clip grouped by platform for a producer to
// watch, copy, approve and download. The page polls the job while it runs and stops once it is done.
export function JobView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  // Bumped when something outside the poll, such as a resumed upload, makes the job live again.
  const [pollKey, setPollKey] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  useReviewKeys();

  const load = useCallback(async () => {
    const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
    const body = await res.json();
    if (res.status === 404) throw new Gone(body.error ?? "There is no such job.");
    if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
    return body as Job;
  }, [id]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await load();
        if (stopped) return;
        setJob(next);
        setError(null);
        if (live(next)) timer = setTimeout(tick, POLL_MS);
      } catch (err) {
        if (stopped) return;
        setError((err as Error).message);
        // A job that is gone stays gone; anything else is worth another look.
        if (err instanceof Gone) setMissing(true);
        else timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load, pollKey]);

  if (missing)
    return (
      <p className="mt-10 text-footnote text-secondary">
        {error}{" "}
        <Link href="/studio" className="font-semibold text-tint hover:underline">
          Back to the studio
        </Link>
      </p>
    );
  if (!job) return <p className="mt-10 text-footnote text-secondary">{error ?? "Loading the job…"}</p>;

  // Re-cutting needs the match video, which a producer may have deleted to free space.
  const canCut = job.status === "done" && Boolean(job.source) && !job.sourceDeleted;
  const order = postOrder(job.clips, job.moments);
  const rankOf = (c: JobClip) => order.get(c.id)?.rank ?? Infinity;
  const byPlacement = job.placements
    .map((p) => ({ placement: p, clips: job.clips.filter((c) => c.placement === p).sort((a, b) => rankOf(a) - rankOf(b)) }))
    .filter((g) => g.clips.length > 0);
  const based = [job.services.transcript ? "the crowd and a commentary transcript" : "the crowd's noise", job.services.model ? "with copy written by the model" : "with rule-written copy"].join(", ");

  return (
    <>
      <header className="mt-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-caption font-semibold uppercase tracking-[0.06em] text-secondary">
            {SPORT[job.sport].label}
            {job.language ? ` · posts in ${job.language}` : ""}
            {job.replay ? " · with replays" : ""}
            {job.brand?.logo ? " · with your logo" : ""}
          </p>
          <h1 className="mt-1 text-[34px] font-semibold leading-tight tracking-tight">{job.title}</h1>
          {job.source && (
            <p className="num mt-1 text-footnote text-secondary">
              {matchClock(job.source.durationSec)} of video · {job.clips.length} clips · picks from {based}
            </p>
          )}
        </div>
        {!live(job) && (
          <div className="flex flex-col items-end gap-1">
            {canCut && <DeleteSource job={job} onDeleted={setJob} />}
            <DeleteJob id={job.id} onDeleted={() => router.push("/studio")} />
          </div>
        )}
      </header>
      {job.status === "done" && job.clips.some((c) => c.render.state === "ready") && <ExportLinks job={job} />}
      {job.sourceDeleted && <p className="mt-4 text-caption text-secondary">The match video was deleted to free space. The clips stay; trimming, new hooks, new platforms and picked moments need the video, so they are off.</p>}
      {canCut && (
        <AddPlatforms
          job={job}
          onQueued={(next) => {
            setJob(next);
            setPollKey((k) => k + 1);
          }}
        />
      )}

      {job.status === "uploading" && <ResumeUpload job={job} onDone={() => setPollKey((k) => k + 1)} />}
      {job.status === "failed" && (
        <p role="alert" className="mt-6 text-footnote text-tally">
          The job stopped: {job.error ?? "see the stage that failed below."}
        </p>
      )}

      <ol className="mt-8 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4" aria-label="Stages">
        {job.stages.map((s) => (
          <li key={s.id} className="rounded-xl bg-grouped px-3 py-2.5">
            <p className="flex items-center gap-2 text-footnote font-semibold">
              <span aria-hidden className={s.state === "failed" ? "text-tally" : s.state === "done" ? "text-go" : "text-secondary"}>
                {STAGE_MARK[s.state]}
              </span>
              {s.label}
              <span className="sr-only">: {s.state}</span>
              {took(s) && <span className="num ml-auto text-caption font-normal text-secondary">{took(s)}</span>}
            </p>
            {s.detail && <p className="mt-0.5 text-caption text-secondary">{s.detail}</p>}
          </li>
        ))}
      </ol>

      <EnergyTimeline job={job} onPick={canCut && job.placements.some((p) => !isMontage(p)) ? setPicked : undefined} />
      {picked !== null && job.status === "done" && (
        <PickBar
          jobId={job.id}
          at={picked}
          onCancel={() => setPicked(null)}
          onQueued={(next) => {
            setPicked(null);
            setJob(next);
            setPollKey((k) => k + 1);
          }}
        />
      )}

      {job.status === "done" && (
        <PostFirst jobId={job.id} groups={byPlacement} order={order} onChange={(next) => setJob((j) => j && { ...j, clips: j.clips.map((x) => (x.id === next.id ? next : x)) })} />
      )}

      {byPlacement.length > 0 && (
        <p className="mt-10 text-caption text-secondary">
          Review from the keyboard: <Kbd>J</Kbd> and <Kbd>K</Kbd> move between clips, <Kbd>A</Kbd> approves, <Kbd>R</Kbd> rejects, <Kbd>U</Kbd> undoes.
        </p>
      )}

      {byPlacement.map((g) => (
        <section key={g.placement} className="mt-12" aria-labelledby={`p-${g.placement}`}>
          <h2 id={`p-${g.placement}`} className="text-title2 font-semibold">
            {PLACEMENT_LABEL[g.placement]}{" "}
            <span className="num text-footnote font-normal text-secondary">
              {PLACEMENTS[g.placement].aspect} · {g.clips.length} {g.clips.length === 1 ? "clip" : "clips"}
            </span>
          </h2>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {g.clips.map((c) => (
              <ClipCard
                key={c.id}
                jobId={job.id}
                clip={c}
                strength={g.clips.length > 1 ? order.get(c.id) : undefined}
                editable={canCut}
                hasCaptions={job.services.transcript}
                durationSec={job.source?.durationSec ?? 0}
                onChange={(next) => setJob((j) => j && { ...j, clips: j.clips.map((x) => (x.id === next.id ? next : x)) })}
                onQueued={() => setPollKey((k) => k + 1)}
              />
            ))}
          </div>
        </section>
      ))}

      {job.moments.length > 0 && <MomentsAndSkips job={job} />}
    </>
  );
}

// The answer to "what do I post now": each platform's clip to post first, one line each, linked to its card.
function PostFirst({ jobId, groups, order, onChange }: { jobId: string; groups: { placement: JobPlacement; clips: JobClip[] }[]; order: Map<string, Strength & { rank: number }>; onChange: (clip: JobClip) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firsts = groups.flatMap((g) => {
    const clip = g.clips.find((c) => c.render.state === "ready" && c.decision?.value !== "rejected");
    return clip ? [{ placement: g.placement, clip, score: order.get(clip.id)?.score }] : [];
  });
  if (firsts.length === 0) return null;
  const waiting = firsts.filter((f) => !f.clip.decision);
  // One decision per clip, through the same route the cards use, so each is recorded on its own.
  const approveAll = async () => {
    setBusy(true);
    setError(null);
    for (const { clip } of waiting) {
      const res = await fetch(`/api/jobs/${jobId}/clips/${clip.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "approved" }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `The server answered ${res.status}.`);
        break;
      }
      onChange(body);
    }
    setBusy(false);
  };
  return (
    <section aria-labelledby="post-first" className="mt-10 rounded-[14px] bg-grouped p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="post-first" className="text-footnote font-semibold">
          Post first
        </h2>
        {waiting.length > 0 && (
          <button type="button" disabled={busy} onClick={approveAll} className="press inline-flex h-8 items-center rounded-full bg-button px-3 text-caption font-semibold text-white hover:bg-button-hover disabled:opacity-40">
            {busy ? "Approving…" : `Approve ${waiting.length === 1 ? "this one" : `these ${waiting.length}`}`}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-caption text-tally">
          {error}
        </p>
      )}
      <ul className="mt-2 grid gap-1">
        {firsts.map(({ placement, clip, score }) => (
          <li key={placement}>
            <a href={`#clip-${clip.id}`} className="press flex items-baseline gap-3 rounded-lg px-2 py-1.5 hover:bg-fill/60">
              <span className="w-36 shrink-0 text-caption font-semibold">{PLACEMENT_LABEL[placement]}</span>
              <span className="min-w-0 truncate text-footnote">{clip.hook}</span>
              <span className="num ml-auto shrink-0 text-caption text-secondary">
                {length(clip)} s{score !== undefined ? ` · strength ${score}` : ""}
                {clip.decision?.value === "approved" ? " · approved" : ""}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Confirms a second picked on the timeline before it becomes clips.
function PickBar({ jobId, at, onCancel, onQueued }: { jobId: string; at: number; onCancel: () => void; onQueued: (job: Job) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div role="group" aria-label="New moment" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-tint/10 px-4 py-3">
      <p className="text-footnote">
        Make a clip for every short platform from <span className="num font-semibold">{matchClock(at)}</span>? The cut opens on the build-up before it.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(`/api/jobs/${jobId}/moments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ at }) });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
            onQueued(body);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
        className="press inline-flex h-8 items-center rounded-full bg-button px-3 text-caption font-semibold text-white hover:bg-button-hover disabled:opacity-40"
      >
        {busy ? "Planning…" : "Make clips"}
      </button>
      <button type="button" onClick={onCancel} className="press rounded-md text-caption font-semibold text-tint hover:underline">
        Cancel
      </button>
      {error && (
        <p role="alert" className="w-full text-caption text-tally">
          {error}
        </p>
      )}
    </div>
  );
}

// The rendered file and its post, checked against the platform: one line when all is well, the list on demand.
function Preflight({ clip }: { clip: JobClip }) {
  const checks = preflight(clip);
  if (checks.length === 0) return null;
  const failed = checks.filter((c) => !c.ok);
  return (
    <details className="mt-2 text-caption">
      <summary className={`cursor-pointer font-semibold ${failed.length ? "text-tally" : "text-go"}`}>
        {failed.length ? `${failed.length} ${failed.length === 1 ? "problem" : "problems"} for ${PLACEMENTS[clip.placement].platform}` : `Ready for ${PLACEMENTS[clip.placement].platform}`}
      </summary>
      <ul className="mt-1 space-y-0.5 pl-1">
        {checks.map((c) => (
          <li key={c.label} className={c.ok ? "text-secondary" : "text-tally"}>
            <span aria-hidden>{c.ok ? "✓ " : "✗ "}</span>
            {c.label}
          </li>
        ))}
      </ul>
    </details>
  );
}

const Kbd = ({ children }: { children: string }) => <kbd className="num rounded border border-separator bg-fill px-1.5 py-px text-caption font-semibold text-label">{children}</kbd>;

/** How long a stage took, or has been running at the last poll, as "4 s" or "2 min 5 s". */
function took(s: JobStage) {
  if (!s.startedAt || (!s.endedAt && s.state !== "running")) return undefined;
  const end = s.endedAt ? Date.parse(s.endedAt) : Date.now();
  const sec = Math.max(0, Math.round((end - Date.parse(s.startedAt)) / 1000));
  return sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min ${sec % 60} s`;
}

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

// Where the clip sits in its platform's posting order, and the evidence that put it there.
function StrengthLine({ strength }: { strength: Strength & { rank: number } }) {
  return (
    <details className="mt-3 text-caption">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <span className={`num rounded-full px-2 py-0.5 font-semibold ${strength.rank === 1 ? "bg-tint text-white" : "bg-fill text-label"}`}>Post {ordinal(strength.rank)}</span>
        <span className="num text-secondary">strength {strength.score} of 100</span>
      </summary>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-secondary">
        {strength.reasons.length ? strength.reasons.map((r) => <li key={r}>{r}</li>) : <li>Only the moment&apos;s own score.</li>}
      </ul>
    </details>
  );
}

/** Where a vertical feed puts its like, comment and share buttons: a rail down the right, above the caption. */
const RAIL = { width: 0.15, top: 0.42, bottom: 0.82 };

// What the app draws over a clip, shaded: the top band, the caption and account at the bottom and, on a
// vertical feed, the button rail. Burned-in text stays out of all three; this shows a producer the play does too.
function SafeZones({ placement }: { placement: JobPlacement }) {
  const p = PLACEMENTS[placement];
  const band = "pointer-events-none absolute inset-x-0 bg-tally/35 outline outline-1 outline-tally/70";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className={`${band} top-0`} style={{ height: `${p.safeTop * 100}%` }} />
      <div className={`${band} bottom-0 grid place-items-center`} style={{ height: `${p.safeBottom * 100}%` }}>
        <span className="rounded bg-black/60 px-1.5 text-[10px] font-semibold text-white">{p.platform}&apos;s caption and buttons</span>
      </div>
      {p.aspect === "9:16" && (
        <div className="pointer-events-none absolute right-0 bg-tally/35 outline outline-1 outline-tally/70" style={{ width: `${RAIL.width * 100}%`, top: `${RAIL.top * 100}%`, height: `${(RAIL.bottom - RAIL.top) * 100}%` }} />
      )}
    </div>
  );
}

const ASPECT_CLASS: Record<string, string> = { "9:16": "aspect-[9/16]", "1:1": "aspect-square", "16:9": "aspect-video" };

type ClipCardProps = { jobId: string; clip: JobClip; strength?: Strength & { rank: number }; editable: boolean; hasCaptions: boolean; durationSec: number; onChange: (clip: JobClip) => void; onQueued: () => void };

function ClipCard({ jobId, clip, strength, editable, hasCaptions, durationSec, onChange, onQueued }: ClipCardProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [zones, setZones] = useState(false);
  const src = `/api/jobs/${jobId}/clips/${clip.id}`;
  const post = postText(clip);

  async function decide(decision: "approved" | "rejected" | null) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(src, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
      onChange(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article
      id={`clip-${clip.id}`}
      data-clip-card
      tabIndex={-1}
      aria-label={`${PLACEMENT_LABEL[clip.placement]}: ${clip.hook}`}
      className="flex scroll-m-24 flex-col rounded-[14px] bg-grouped p-3 outline-none focus:ring-2 focus:ring-tint"
      data-decision={clip.decision?.value ?? "none"}
    >
      <div className={`${ASPECT_CLASS[PLACEMENTS[clip.placement].aspect]} flex max-h-[440px] justify-center overflow-hidden rounded-lg bg-black`}>
        {clip.render.state === "ready" ? (
          // The inner box keeps the clip's own shape when the card caps its height, so the zones line up.
          <div className={`${ASPECT_CLASS[PLACEMENTS[clip.placement].aspect]} relative h-full max-w-full`}>
            <video src={src} poster={clip.render.cover ? `${src}/cover` : undefined} controls playsInline preload="metadata" className="size-full object-contain" aria-label={clip.title} />
            {zones && <SafeZones placement={clip.placement} />}
          </div>
        ) : (
          <p className="grid size-full place-items-center p-4 text-center text-caption text-secondary">
            {clip.render.state === "failed" ? `Render failed: ${clip.render.error}` : clip.render.state === "rendering" ? "Rendering…" : "Waiting to render"}
          </p>
        )}
      </div>
      {strength && <StrengthLine strength={strength} />}
      <p className="mt-3 text-footnote font-semibold text-pretty">{clip.hook}</p>
      <p className="num mt-0.5 text-caption text-secondary">
        {length(clip)} s · from {matchClock(clip.segments[0].start)}
        {clip.replay && " · ends with a slow-motion replay"}
      </p>
      <p className="mt-2 whitespace-pre-line text-caption text-label/85 text-pretty">{post}</p>
      <p className="mt-2 text-caption text-secondary text-pretty">{clip.why}</p>
      <Preflight clip={clip} />
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-3">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(post).then(() => setCopied(true));
          }}
          className="press rounded-md text-caption font-semibold text-tint hover:underline"
        >
          {copied ? "Caption copied" : "Copy caption"}
        </button>
        {clip.render.state === "ready" && (
          <a href={`${src}?download=1`} className="press rounded-md text-caption font-semibold text-tint hover:underline">
            Download
          </a>
        )}
        {clip.render.state === "ready" && (
          <button type="button" aria-pressed={zones} onClick={() => setZones((z) => !z)} className="press rounded-md text-caption font-semibold text-tint hover:underline">
            {zones ? "Hide app zones" : "App zones"}
          </button>
        )}
        {clip.render.cover && (
          <a href={`${src}/cover?download=1`} className="press rounded-md text-caption font-semibold text-tint hover:underline">
            Cover
          </a>
        )}
        {hasCaptions && (
          <a href={`${src}/srt`} className="press rounded-md text-caption font-semibold text-tint hover:underline">
            Captions (.srt)
          </a>
        )}
      </div>
      {editable && (
        <div className="flex flex-wrap gap-x-4">
          {clip.segments.length === 1 && <TrimControl jobId={jobId} clip={clip} durationSec={durationSec} onChange={onChange} onQueued={onQueued} />}
          <HookControl jobId={jobId} clip={clip} durationSec={durationSec} onChange={onChange} onQueued={onQueued} />
        </div>
      )}
      <div className="mt-3 flex items-center gap-2 border-t border-separator/60 pt-3">
        {clip.decision ? (
          <>
            <p className={`text-footnote font-semibold ${clip.decision.value === "approved" ? "text-go" : "text-label"}`}>{clip.decision.value === "approved" ? "Approved" : "Rejected"}</p>
            <button type="button" data-shortcut="undo" disabled={saving} onClick={() => decide(null)} className="press rounded-md text-caption font-semibold text-tint hover:underline disabled:opacity-40">
              Undo
            </button>
          </>
        ) : (
          <>
            <button type="button" data-shortcut="approve" disabled={saving} onClick={() => decide("approved")} aria-label={`Approve ${clip.title}`} className="press inline-flex h-8 items-center rounded-full bg-button px-3 text-caption font-semibold text-white hover:bg-button-hover disabled:opacity-40">
              Approve
            </button>
            <button type="button" data-shortcut="reject" disabled={saving} onClick={() => decide("rejected")} aria-label={`Reject ${clip.title}`} className="press inline-flex h-8 items-center rounded-full bg-fill px-3 text-caption font-semibold text-label hover:bg-separator disabled:opacity-40">
              Reject
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-caption text-tally">
          {error}
        </p>
      )}
    </article>
  );
}

const STEP_SEC = 1;

// Nudge a clip's edges a second at a time and render it again. The server checks the new edges.
function TrimControl({ jobId, clip, durationSec, onChange, onQueued }: Omit<ClipCardProps, "editable" | "hasCaptions">) {
  const [open, setOpen] = useState(false);
  const [edges, setEdges] = useState(clip.segments[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="press mt-2 self-start rounded-md text-caption font-semibold text-tint hover:underline">
        Adjust the cut
      </button>
    );
  }
  const nudge = (edge: "start" | "end", by: number) =>
    setEdges((e) => ({ ...e, [edge]: Math.min(durationSec, Math.max(0, Math.round((e[edge] + by) * 10) / 10)) }));
  const row = (edge: "start" | "end", label: string) => (
    <div className="flex items-center gap-2">
      <span className="w-10 text-caption text-secondary">{label}</span>
      <button type="button" aria-label={`${label} one second earlier`} onClick={() => nudge(edge, -STEP_SEC)} className="press h-7 w-8 rounded-md bg-fill text-caption font-semibold">
        −1
      </button>
      <span className="num w-14 text-center text-caption">{matchClock(edges[edge])}</span>
      <button type="button" aria-label={`${label} one second later`} onClick={() => nudge(edge, STEP_SEC)} className="press h-7 w-8 rounded-md bg-fill text-caption font-semibold">
        +1
      </button>
    </div>
  );
  return (
    <div className="mt-3 grid w-full gap-2 rounded-lg bg-fill/50 p-2">
      {row("start", "Start")}
      {row("end", "End")}
      <p className="num text-caption text-secondary">{Math.round(edges.end - edges.start)} s</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              const res = await fetch(`/api/jobs/${jobId}/clips/${clip.id}/trim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edges) });
              const body = await res.json();
              if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
              onChange(body);
              onQueued();
              setOpen(false);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          className="press inline-flex h-8 items-center rounded-full bg-button px-3 text-caption font-semibold text-white hover:bg-button-hover disabled:opacity-40"
        >
          Render this cut
        </button>
        <button type="button" onClick={() => setOpen(false)} className="press rounded-md px-2 text-caption font-semibold text-secondary hover:text-label">
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-caption text-tally">
          {error}
        </p>
      )}
    </div>
  );
}

// Swap the words burned on screen for a clip's first seconds: one of its options, or the producer's own.
function HookControl({ jobId, clip, onChange, onQueued }: Omit<ClipCardProps, "editable" | "hasCaptions">) {
  const [open, setOpen] = useState(false);
  const [hook, setHook] = useState(clip.hook);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="press mt-2 self-start rounded-md text-caption font-semibold text-tint hover:underline">
        Change the hook
      </button>
    );
  }
  const options = [...new Set([clip.hook, ...(clip.hooks ?? [])])];
  return (
    <div className="mt-3 grid w-full gap-2 rounded-lg bg-fill/50 p-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={hook === o}
            onClick={() => setHook(o)}
            className={`press rounded-full border px-2.5 py-1 text-caption ${hook === o ? "border-tint bg-tint/15 text-label" : "border-separator text-secondary hover:bg-fill"}`}
          >
            {o}
          </button>
        ))}
      </div>
      <label htmlFor={inputId} className="sr-only">
        Your own hook
      </label>
      <input id={inputId} value={hook} maxLength={60} onChange={(e) => setHook(e.target.value)} className="h-9 rounded-md bg-fill px-2 text-caption text-label" />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving || !hook.trim() || hook.trim() === clip.hook}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              const res = await fetch(`/api/jobs/${jobId}/clips/${clip.id}/hook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hook }) });
              const body = await res.json();
              if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
              onChange(body);
              onQueued();
              setOpen(false);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          className="press inline-flex h-8 items-center rounded-full bg-button px-3 text-caption font-semibold text-white hover:bg-button-hover disabled:opacity-40"
        >
          Render with this hook
        </button>
        <button type="button" onClick={() => setOpen(false)} className="press rounded-md px-2 text-caption font-semibold text-secondary hover:text-label">
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-caption text-tally">
          {error}
        </p>
      )}
    </div>
  );
}

// Approved clips, or every rendered clip, as one zip with captions, posts and a manifest.
function ExportLinks({ job }: { job: Job }) {
  const [copied, setCopied] = useState(false);
  const approvedClips = job.clips.filter((c) => c.render.state === "ready" && c.decision?.value === "approved");
  const approved = approvedClips.length;
  // Every approved post, headed by its platform, the way posts.txt in the zip has them.
  const allPosts = () => approvedClips.map((c) => `${PLACEMENT_LABEL[c.placement]} · ${c.id}.mp4\n${postText(c)}`).join("\n\n");
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      {approved > 0 ? (
        <a href={`/api/jobs/${job.id}/export`} className="press inline-flex h-9 items-center rounded-full bg-button px-4 text-caption font-semibold text-white hover:bg-button-hover">
          Download approved ({approved})
        </a>
      ) : (
        <span className="text-caption text-secondary">Approve clips to download them together.</span>
      )}
      {approved > 0 && (
        <button type="button" onClick={() => void navigator.clipboard?.writeText(allPosts()).then(() => setCopied(true))} className="press rounded-md text-caption font-semibold text-tint hover:underline">
          {copied ? "Posts copied" : "Copy every approved post"}
        </button>
      )}
      <a href={`/api/jobs/${job.id}/export?all=1`} className="press rounded-md text-caption font-semibold text-tint hover:underline">
        Download every clip
      </a>
    </div>
  );
}

// Cut a finished job for more platforms, from the moments it already found.
function AddPlatforms({ job, onQueued }: { job: Job; onQueued: (job: Job) => void }) {
  const missing = JOB_PLACEMENTS.filter((p) => !job.placements.includes(p));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<JobPlacement | null>(null);
  if (missing.length === 0 || job.moments.length === 0) return null;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <span className="text-caption text-secondary">Also cut it for</span>
      {missing.map((p) => (
        <button
          key={p}
          type="button"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(p);
            setError(null);
            try {
              const res = await fetch(`/api/jobs/${job.id}/placements`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ placements: [p] }) });
              const body = await res.json();
              if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
              onQueued(body);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(null);
            }
          }}
          className="press h-8 rounded-full border border-separator px-3 text-caption font-semibold text-label hover:bg-fill disabled:opacity-40"
        >
          {busy === p ? "Adding…" : `+ ${PLACEMENT_LABEL[p]}`}
        </button>
      ))}
      {error && (
        <span role="alert" className="text-caption text-tally">
          {error}
        </span>
      )}
    </div>
  );
}

function MomentsAndSkips({ job }: { job: Job }) {
  const titles = new Map(job.moments.map((m) => [m.id, m.title]));
  const skipsBy = (p: JobPlacement) => job.skipped.filter((s) => s.placement === p);
  return (
    <section className="mt-14" aria-labelledby="moments">
      <h2 id="moments" className="text-title2 font-semibold">
        What it found, and what each platform left out
      </h2>
      <ol className="mt-4 grid gap-1 sm:grid-cols-2">
        {job.moments.map((m) => (
          <li key={m.id} className="flex items-baseline gap-3 rounded-lg px-2 py-1.5 hover:bg-fill/60">
            <span className="num w-12 shrink-0 text-caption text-tint">{matchClock(m.peak)}</span>
            <span className="min-w-0 text-footnote">{m.title}</span>
            <span className="num ml-auto shrink-0 text-caption text-secondary">
              {m.score.toFixed(2)} · {m.signals.join(" + ") || "no signal"}
            </span>
          </li>
        ))}
      </ol>
      {job.placements.map((p) =>
        skipsBy(p).length ? (
          <details key={p} className="mt-4 rounded-xl bg-grouped px-4 py-3">
            <summary className="cursor-pointer text-footnote font-semibold">
              {PLACEMENT_LABEL[p]} left out {skipsBy(p).length}
            </summary>
            <ul className="mt-2 grid gap-1">
              {skipsBy(p).map((s) => (
                <li key={s.momentId} className="text-caption text-secondary">
                  <span className="text-label">{titles.get(s.momentId)}</span>: {s.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null,
      )}
    </section>
  );
}

function ResumeUpload({ job, onDone }: { job: Job; onDone: () => void }) {
  const inputId = useId();
  const [sent, setSent] = useState(job.upload.received);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-6 rounded-[14px] bg-grouped px-4 py-3">
      <p className="text-footnote">
        The upload stopped at {Math.round((sent / job.upload.size) * 100)}%. Choose <span className="font-semibold">{job.upload.fileName}</span> again to carry on from there.
      </p>
      <input
        id={inputId}
        type="file"
        accept="video/*,.mkv,.mts"
        className="mt-2 text-caption"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size !== job.upload.size) return setError(`That file is ${file.size} bytes; the job expects ${job.upload.size}. Choose the same file.`);
          setError(null);
          try {
            await uploadFile({ jobId: job.id, file, from: job.upload.received, chunkBytes: 8 * 1024 * 1024, onProgress: setSent });
            onDone();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
      {error && (
        <p role="alert" className="mt-1.5 text-caption text-tally">
          {error}
        </p>
      )}
    </div>
  );
}

const gb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

// Frees most of a job's space: the match video goes, the clips stay.
function DeleteSource({ job, onDeleted }: { job: Job; onDeleted: (job: Job) => void }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="press rounded-md text-caption font-semibold text-secondary hover:text-label">
        Free {gb(job.upload.size)}: delete the match video
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-caption">
      <span className="text-secondary">Keep the clips, and give up trimming and re-cutting?</span>
      <button
        type="button"
        onClick={async () => {
          const res = await fetch(`/api/jobs/${job.id}/source`, { method: "DELETE" });
          const body = await res.json().catch(() => ({}));
          if (res.ok) onDeleted(body.job);
          else setError(body.error ?? `The server answered ${res.status}.`);
        }}
        className="press rounded-md font-semibold text-tally hover:underline"
      >
        Delete the video
      </button>
      <button type="button" onClick={() => setAsking(false)} className="press rounded-md font-semibold text-tint hover:underline">
        Keep it
      </button>
      {error && <span className="text-tally">{error}</span>}
    </div>
  );
}

function DeleteJob({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="press rounded-md text-caption font-semibold text-secondary hover:text-tally">
        Delete this job
      </button>
    );
  }
  return (
    <div className="flex items-center gap-3 text-caption">
      <span className="text-secondary">Delete the video and every clip?</span>
      <button
        type="button"
        onClick={async () => {
          const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
          if (res.ok) onDeleted();
          else setError((await res.json().catch(() => ({}))).error ?? `The server answered ${res.status}.`);
        }}
        className="press rounded-md font-semibold text-tally hover:underline"
      >
        Delete
      </button>
      <button type="button" onClick={() => setAsking(false)} className="press rounded-md font-semibold text-tint hover:underline">
        Keep it
      </button>
      {error && <span className="text-tally">{error}</span>}
    </div>
  );
}

const STATUS_LABEL: Record<Job["status"], string> = { uploading: "Uploading", queued: "Queued", running: "Working", done: "Done", failed: "Stopped" };

// One match in the list: the cover of its clip to post first, then what it is and how far review has got.
export function JobLink({ id, title, sport, status, durationSec, clips, ready, approved, cover }: JobSummary) {
  return (
    <Link href={`/studio/jobs/${id}`} className="press group flex flex-col overflow-hidden rounded-xl bg-page ring-1 ring-separator/60 hover:ring-tint">
      <div className="relative aspect-video bg-black">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- a job's own file, served by the API, not a static asset
          <img src={`/api/jobs/${id}/clips/${cover}/cover`} alt="" loading="lazy" className="size-full object-cover opacity-90 group-hover:opacity-100" />
        ) : (
          <span className="grid size-full place-items-center text-caption text-secondary">{status === "done" ? "No cover" : `${STATUS_LABEL[status]}…`}</span>
        )}
        <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status === "done" ? "bg-black/60 text-white" : status === "failed" ? "bg-tally text-white" : "bg-tint text-white"}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      <div className="px-3 py-2.5">
        <p className="truncate text-footnote font-semibold">{title}</p>
        <p className="num mt-0.5 truncate text-caption text-secondary">
          {SPORT[sport].label}
          {durationSec ? ` · ${matchClock(durationSec)}` : ""}
          {clips ? ` · ${ready} of ${clips} clips` : ""}
          {approved ? ` · ${approved} approved` : ""}
        </p>
      </div>
    </Link>
  );
}
