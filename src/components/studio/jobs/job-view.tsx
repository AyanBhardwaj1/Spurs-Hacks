"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import { PLACEMENTS } from "@/lib/rundown/platforms";
import { matchClock } from "@/lib/jobs/moments";
import { clipSeconds, isMontage } from "@/lib/jobs/planner";
import { postText } from "@/lib/jobs/post";
import { postOrder, type Strength } from "@/lib/jobs/rank";
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
          <p className="text-caption font-semibold uppercase tracking-[0.06em] text-secondary">Your match</p>
          <h1 className="mt-1 text-[34px] font-semibold leading-tight tracking-tight">{job.title}</h1>
          {job.source && (
            <p className="num mt-1 text-footnote text-secondary">
              {matchClock(job.source.durationSec)} of video · {job.clips.length} clips · picks from {based}
            </p>
          )}
        </div>
        {!live(job) && <DeleteJob id={job.id} onDeleted={() => router.push("/studio")} />}
      </header>
      {job.status === "done" && job.clips.some((c) => c.render.state === "ready") && <ExportLinks job={job} />}
      {job.status === "done" && (
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

      <EnergyTimeline job={job} onPick={job.status === "done" && job.placements.some((p) => !isMontage(p)) ? setPicked : undefined} />
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
                editable={job.status === "done" && Boolean(job.source)}
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

const Kbd = ({ children }: { children: string }) => <kbd className="num rounded border border-separator bg-fill px-1.5 py-px text-caption font-semibold text-label">{children}</kbd>;

/** How long a finished stage took, as "4 s" or "2 min 5 s"; nothing for a stage that has not finished. */
function took(s: JobStage) {
  if (!s.startedAt || !s.endedAt) return undefined;
  const sec = Math.max(0, Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000));
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

const ASPECT_CLASS: Record<string, string> = { "9:16": "aspect-[9/16]", "1:1": "aspect-square", "16:9": "aspect-video" };

type ClipCardProps = { jobId: string; clip: JobClip; strength?: Strength & { rank: number }; editable: boolean; hasCaptions: boolean; durationSec: number; onChange: (clip: JobClip) => void; onQueued: () => void };

function ClipCard({ jobId, clip, strength, editable, hasCaptions, durationSec, onChange, onQueued }: ClipCardProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
      data-clip-card
      tabIndex={-1}
      aria-label={`${PLACEMENT_LABEL[clip.placement]}: ${clip.hook}`}
      className="flex scroll-m-24 flex-col rounded-[14px] bg-grouped p-3 outline-none focus:ring-2 focus:ring-tint"
      data-decision={clip.decision?.value ?? "none"}
    >
      <div className={`${ASPECT_CLASS[PLACEMENTS[clip.placement].aspect]} max-h-[440px] overflow-hidden rounded-lg bg-black`}>
        {clip.render.state === "ready" ? (
          <video src={src} poster={clip.render.cover ? `${src}/cover` : undefined} controls playsInline preload="metadata" className="size-full object-contain" aria-label={clip.title} />
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
      {editable && clip.segments.length === 1 && <TrimControl jobId={jobId} clip={clip} durationSec={durationSec} onChange={onChange} onQueued={onQueued} />}
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
    <div className="mt-3 grid gap-2 rounded-lg bg-fill/50 p-2">
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

// Approved clips, or every rendered clip, as one zip with captions, posts and a manifest.
function ExportLinks({ job }: { job: Job }) {
  const approved = job.clips.filter((c) => c.render.state === "ready" && c.decision?.value === "approved").length;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      {approved > 0 ? (
        <a href={`/api/jobs/${job.id}/export`} className="press inline-flex h-9 items-center rounded-full bg-button px-4 text-caption font-semibold text-white hover:bg-button-hover">
          Download approved ({approved})
        </a>
      ) : (
        <span className="text-caption text-secondary">Approve clips to download them together.</span>
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

export function JobLink({ id, title, status, clips }: { id: string; title: string; status: Job["status"]; clips: number }) {
  return (
    <Link href={`/studio/jobs/${id}`} className="press flex items-baseline justify-between gap-4 rounded-xl bg-grouped px-4 py-3 hover:bg-fill/60">
      <span className="truncate text-footnote font-semibold">{title}</span>
      <span className="num shrink-0 text-caption text-secondary">{status === "done" ? `${clips} clips` : status}</span>
    </Link>
  );
}
