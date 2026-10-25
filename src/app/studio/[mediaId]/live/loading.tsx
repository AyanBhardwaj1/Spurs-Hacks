import { StudioBar, studioContainer } from "@/components/studio/studio-bar";

// Holds the live view's shape while the route resolves, so the player and the feed do not jump in.
export default function Loading() {
  return (
    <>
      <StudioBar current="Live" />
      <main className={`${studioContainer} pt-6`} aria-busy>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-4">
            <div className="aspect-video rounded-[14px] bg-grouped" />
            <div className="h-36 rounded-[18px] bg-grouped" />
          </div>
          <div className="min-h-[480px] rounded-[18px] bg-grouped" />
        </div>
      </main>
    </>
  );
}
