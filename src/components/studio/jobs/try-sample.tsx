"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Starts a job on a synthetic match the server makes, so anyone can see the whole flow without a video.
export function TrySample({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className={`inline-flex flex-col gap-1 ${className}`}>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/jobs/sample", { method: "POST" });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
            router.push(`/studio/jobs/${body.job.id}`);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
        className="press inline-flex h-10 items-center rounded-full border border-separator px-5 text-footnote font-semibold text-label hover:bg-fill disabled:opacity-40"
      >
        {busy ? "Making a sample match…" : "Try a sample match"}
      </button>
      {error && (
        <span role="alert" className="text-caption text-tally">
          {error}
        </span>
      )}
    </span>
  );
}
