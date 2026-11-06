"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { PLACEMENTS } from "@/lib/rundown/platforms";
import { DEFAULT_PLACEMENTS, JOB_PLACEMENTS, SPORTS, type JobPlacement, type JobSport } from "@/lib/jobs/types";
import { uploadFile } from "./upload";

const SPORT_LABEL: Record<JobSport, string> = { soccer: "Soccer", basketball: "Basketball", "american-football": "American football", other: "Another sport" };
export const PLACEMENT_LABEL: Record<JobPlacement, string> = {
  tiktok: "TikTok",
  "instagram-reel": "Instagram Reels",
  "youtube-short": "YouTube Shorts",
  "x-video": "X",
  "x-square": "X, square",
  "youtube-video": "YouTube highlights",
};

const mb = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(bytes < 1024 ** 3 ? 0 : 1)} MB`;

// Upload a match and choose where its clips go. The video goes up in chunks the server can resume, and
// the page moves to the job as soon as the last chunk lands.
export function NewJobForm() {
  const router = useRouter();
  const ids = { title: useId(), sport: useId(), file: useId() };
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState<JobSport>("soccer");
  const [placements, setPlacements] = useState<JobPlacement[]>(DEFAULT_PLACEMENTS);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (p: JobPlacement) => setPlacements((now) => (now.includes(p) ? now.filter((x) => x !== p) : [...now, p]));
  const uploading = sent !== null;
  const ready = title.trim() && file && placements.length > 0 && !uploading;

  async function start() {
    if (!file) return;
    setError(null);
    setSent(0);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), sport, placements, fileName: file.name, size: file.size }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
      await uploadFile({ jobId: body.job.id, file, from: 0, chunkBytes: body.chunkBytes, onProgress: setSent });
      router.push(`/studio/jobs/${body.job.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSent(null);
    }
  }

  return (
    <form
      className="mt-8 grid max-w-[760px] gap-7"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void start();
      }}
    >
      <div className="grid gap-2">
        <label htmlFor={ids.title} className="text-footnote font-semibold">
          Match
        </label>
        <input
          id={ids.title}
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Spurs v Arsenal, 14 March"
          className="h-11 rounded-lg bg-fill px-3 text-body text-label placeholder:text-secondary/70"
        />
      </div>

      <div className="grid gap-2">
        <label htmlFor={ids.sport} className="text-footnote font-semibold">
          Sport
        </label>
        <select id={ids.sport} value={sport} onChange={(e) => setSport(e.target.value as JobSport)} className="h-11 w-fit rounded-lg bg-fill px-3 text-body text-label">
          {SPORTS.map((s) => (
            <option key={s} value={s}>
              {SPORT_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="grid gap-3">
        <legend className="text-footnote font-semibold">Platforms</legend>
        <p className="-mt-1 text-caption text-secondary">Each one gets its own cut: its shape, its length, its captions and its hashtag limit.</p>
        <div className="flex flex-wrap gap-2">
          {JOB_PLACEMENTS.map((p) => {
            const on = placements.includes(p);
            return (
              <button
                key={p}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(p)}
                className={`press flex h-11 items-center gap-2 rounded-full border px-4 text-footnote font-semibold ${on ? "border-tint bg-tint/15 text-label" : "border-separator text-secondary hover:bg-fill"}`}
              >
                {PLACEMENT_LABEL[p]}
                <span className="num text-caption font-normal text-secondary">{PLACEMENTS[p].aspect}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-2">
        <span className="text-footnote font-semibold">Full match video</span>
        <label
          htmlFor={ids.file}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = e.dataTransfer.files[0];
            if (dropped) setFile(dropped);
          }}
          className={`grid cursor-pointer place-items-center rounded-[14px] border-2 border-dashed px-6 py-10 text-center ${dragging ? "border-tint bg-tint/10" : "border-separator bg-grouped hover:bg-fill/60"}`}
        >
          {file ? (
            <span>
              <span className="block text-body font-semibold text-label">{file.name}</span>
              <span className="num mt-1 block text-caption text-secondary">{mb(file.size)} · choose another to replace it</span>
            </span>
          ) : (
            <span>
              <span className="block text-body font-semibold text-label">Drop a video here, or choose one</span>
              <span className="mt-1 block text-caption text-secondary">MP4, MOV, MKV or WebM. Use footage you have the rights to.</span>
            </span>
          )}
        </label>
        <input id={ids.file} type="file" accept="video/*,.mkv,.mts" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>

      {uploading && file && (
        <div role="status" className="grid gap-2">
          <div className="h-2 overflow-hidden rounded-full bg-fill">
            <div className="h-full rounded-full bg-tint transition-[width]" style={{ width: `${Math.round(((sent ?? 0) / file.size) * 100)}%` }} />
          </div>
          <p className="num text-caption text-secondary">
            Uploading {mb(sent ?? 0)} of {mb(file.size)}. Keep this tab open; if it closes, choose the same file on the job page to resume.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-footnote text-tally">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!ready}
        className="press inline-flex h-11 w-fit items-center rounded-full bg-button px-6 text-footnote font-semibold text-white hover:bg-button-hover disabled:opacity-40"
      >
        {uploading ? "Uploading…" : "Upload and make clips"}
      </button>
    </form>
  );
}
