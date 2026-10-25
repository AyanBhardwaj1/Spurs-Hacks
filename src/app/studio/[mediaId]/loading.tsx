import { StudioBar, studioContainer } from "@/components/studio/studio-bar";

// Holds the page's shape while an unprerendered media ID resolves, so nothing jumps when it arrives.
export default function Loading() {
  return (
    <>
      <StudioBar current="Loading" />
      <main className={`${studioContainer} pt-6`} aria-busy>
        <div className="h-12 w-1/3 rounded-lg bg-grouped" />
        <div className="mt-5 h-36 rounded-[18px] bg-grouped" />
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="aspect-video rounded-[14px] bg-grouped" />
          <div className="rounded-[18px] bg-grouped" />
        </div>
      </main>
    </>
  );
}
