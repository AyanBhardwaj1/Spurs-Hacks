import { CheckIcon } from "@/components/landing/icons";
import { scoreplayMediaUrl } from "@/lib/studio/links";
import type { MatchAnalysis } from "@/lib/studio/types";

const WRITTEN = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

/** What the run wrote onto the source match in ScorePlay: timecoded moments and tags the club can search. */
export function WrittenBack({ writeback, sourceId }: { writeback: NonNullable<MatchAnalysis["writeback"]>; sourceId: number }) {
  return (
    <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote">
      <span className="flex items-center gap-1.5 font-semibold text-go">
        <CheckIcon className="size-4" />
        Written to ScorePlay: {writeback.videoLogs} timecoded moments
        {writeback.tags.length > 0 ? ` and ${writeback.tags.length} tags` : ""} on this match
      </span>
      <span className="text-secondary">at {WRITTEN.format(new Date(writeback.at))}, where the club&rsquo;s team can search them</span>
      <a href={scoreplayMediaUrl(sourceId)} target="_blank" rel="noreferrer" className="rounded-md font-semibold text-tint hover:underline">
        Open the match in ScorePlay <span aria-hidden>↗</span>
      </a>
    </p>
  );
}
