import Link from "next/link";
import type { ReactNode } from "react";

export const studioContainer = "mx-auto w-full max-w-[1440px] px-6 lg:px-8";

type Props = {
  /** The page's place under Studio, such as the match name. Omit on the library itself. */
  current?: string;
  nav?: { href: string; label: string }[];
  children?: ReactNode;
};

export function StudioBar({ current, nav, children }: Props) {
  return (
    <header className="glass-bar sticky top-0 z-30 border-b border-separator/50">
      <div className={`${studioContainer} flex h-14 items-center gap-5`}>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-footnote">
          <Link href="/" className="inline-flex h-8 shrink-0 items-center rounded-md font-semibold">
            Rundown
          </Link>
          <span aria-hidden className="text-separator">
            /
          </span>
          {current ? (
            <>
              <Link href="/studio" className="inline-flex h-8 shrink-0 items-center rounded-md text-secondary hover:text-label">
                Studio
              </Link>
              <span aria-hidden className="text-separator">
                /
              </span>
              <span aria-current="page" className="truncate font-semibold">
                {current}
              </span>
            </>
          ) : (
            <span aria-current="page" className="font-semibold">
              Studio
            </span>
          )}
        </nav>
        {nav && (
          <nav aria-label="Sections" className="ml-auto hidden items-center gap-0.5 lg:flex">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="press inline-flex h-8 items-center rounded-full px-3 text-caption text-label/75 hover:bg-fill hover:text-label"
              >
                {item.label}
              </a>
            ))}
          </nav>
        )}
        <div className={`flex shrink-0 items-center gap-2 ${nav ? "" : "ml-auto"}`}>{children}</div>
      </div>
    </header>
  );
}

export function RunBadge({ recordedAt }: { recordedAt: string }) {
  return <span className="hidden text-caption text-secondary md:inline">Run recorded {recordedAt}</span>;
}

const RECORDED = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Chicago",
  timeZoneName: "short",
});

/** When the run was recorded, in the hackathon's time zone, such as "Oct 22, 5:40 PM CDT". */
export function recordedLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`generatedAt is not a date: ${iso}`);
  return RECORDED.format(date);
}
