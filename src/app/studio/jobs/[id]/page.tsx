import { Suspense } from "react";
import { JobView } from "@/components/studio/jobs/job-view";
import { StudioBar, studioContainer } from "@/components/studio/studio-bar";

// The job is read in the browser and polled while it runs, so this page is a static shell. The id comes
// from useParams, which cacheComponents wants inside a Suspense boundary.
export default function JobPage() {
  return (
    <>
      <StudioBar current="Your match" />
      <main className={`${studioContainer} pb-28`}>
        <Suspense fallback={<p className="mt-10 text-footnote text-secondary">Loading the job…</p>}>
          <JobView />
        </Suspense>
      </main>
    </>
  );
}
