"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { PLACEMENTS } from "@/lib/rundown/platforms";
import { SPORT } from "@/lib/jobs/sports";
import { DEFAULT_PLACEMENTS, JOB_PLACEMENTS, PLACEMENT_LABEL, SPORTS, type JobPlacement, type JobSport } from "@/lib/jobs/types";
import { uploadFile } from "./upload";


const DEFAULT_HIGHLIGHT = "#FFD60A";

const mb = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(bytes < 1024 ** 3 ? 0 : 1)} MB`;

// Upload a match and choose where its clips go. The video goes up in chunks the server can resume, and
// the page moves to the job as soon as the last chunk lands.
export function NewJobForm() {
  const router = useRouter();
  const ids = { title: useId(), sport: useId(), file: useId(), replay: useId(), colour: useId(), logo: useId() };
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState<JobSport>("soccer");
  const [placements, setPlacements] = useState<JobPlacement[]>(DEFAULT_PLACEMENTS);
  const [replay, setReplay] = useState(false);
  const [colour, setColour] = useState(DEFAULT_HIGHLIGHT);
  const [logo, setLogo] = useState<File | null>(null);
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
        body: JSON.stringify({ title: title.trim(), sport, placements, replay, colour, fileName: file.name, size: file.size }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
      if (logo) {
        const sent = await fetch(`/api/jobs/${body.job.id}/logo`, { method: "PUT", body: logo });
        if (!sent.ok) throw new Error((await sent.json()).error ?? `The logo upload failed (${sent.status}).`);
      }
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
              {SPORT[s].label}
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

      <fieldset className="grid gap-3">
        <legend className="text-footnote font-semibold">Your brand</legend>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label htmlFor={ids.colour} className="flex items-center gap-2 text-footnote">
            <input id={ids.colour} type="color" value={colour} onChange={(e) => setColour(e.target.value.toUpperCase())} className="size-9 cursor-pointer rounded-md bg-transparent" />
            Caption highlight
          </label>
          <label htmlFor={ids.logo} className="flex items-center gap-2 text-footnote">
            <span className="press inline-flex h-9 cursor-pointer items-center rounded-full border border-separator px-4 font-semibold hover:bg-fill">{logo ? "Change logo" : "Add a logo"}</span>
            <span className="text-caption text-secondary">{logo ? logo.name : "PNG or JPEG, up to 2 MB. It sits in the top corner of every clip and cover."}</span>
          </label>
          <input
            id={ids.logo}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              setError(picked && picked.size > 2 * 1024 ** 2 ? "The logo is over 2 MB." : null);
              setLogo(picked && picked.size <= 2 * 1024 ** 2 ? picked : null);
            }}
          />
        </div>
      </fieldset>

      <div className="flex items-start gap-3">
        <input id={ids.replay} type="checkbox" checked={replay} onChange={(e) => setReplay(e.target.checked)} className="mt-1 size-4 accent-tint" />
        <label htmlFor={ids.replay} className="grid gap-0.5">
          <span className="text-footnote font-semibold">End each short clip with a slow-motion replay</span>
          <span className="text-caption text-secondary">The three seconds around the play again at half speed, labelled Replay. Adds 6 s to each clip.</span>
        </label>
      </div>

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
