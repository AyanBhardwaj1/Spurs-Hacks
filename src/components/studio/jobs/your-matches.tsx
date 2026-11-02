"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Job } from "@/lib/jobs/types";
import { JobLink } from "./job-view";

type Summary = Pick<Job, "id" | "title" | "status"> & { clips: number };

// The library's way into the product as it is now: upload a match of your own, or open one already made.
export function YourMatches() {
  const [jobs, setJobs] = useState<Summary[] | null>(null);
  useEffect(() => {
    fetch("/api/jobs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then(setJobs, () => setJobs([]));
  }, []);
  return (
    <section className="mt-8 rounded-[18px] bg-grouped p-5" aria-labelledby="your-matches">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="your-matches" className="text-title2 font-semibold">
            Your matches
          </h2>
          <p className="mt-1 text-footnote text-secondary">Upload a full game and get clips cut for TikTok, Reels, Shorts, X and YouTube.</p>
        </div>
        <Link href="/studio/new" className="press inline-flex h-10 items-center rounded-full bg-button px-5 text-footnote font-semibold text-white hover:bg-button-hover">
          Upload a match
        </Link>
      </div>
      {jobs && jobs.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.slice(0, 9).map((j) => (
            <JobLink key={j.id} {...j} />
          ))}
        </div>
      )}
    </section>
  );
}
