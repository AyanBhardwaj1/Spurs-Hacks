import { NewJobForm } from "@/components/studio/jobs/new-job-form";
import { TrySample } from "@/components/studio/jobs/try-sample";
import { StudioBar, studioContainer } from "@/components/studio/studio-bar";

export default function NewJobPage() {
  return (
    <>
      <StudioBar current="New match" />
      <main className={`${studioContainer} pb-28 pt-10`}>
        <p className="text-caption font-semibold uppercase tracking-[0.06em] text-secondary">New match</p>
        <h1 className="mt-1 text-[34px] font-semibold leading-tight tracking-tight">Make clips from a full match</h1>
        <p className="mt-2 max-w-[64ch] text-footnote text-secondary text-pretty">
          Upload the whole game. Rundown finds the moments from the crowd and the commentary, cuts each one for every platform you pick, and puts
          them in front of you to approve. Nothing is posted anywhere.
        </p>
        <p className="mt-4 flex flex-wrap items-center gap-3 text-footnote text-secondary">
          No video to hand? <TrySample />
        </p>
        <NewJobForm />
      </main>
    </>
  );
}
