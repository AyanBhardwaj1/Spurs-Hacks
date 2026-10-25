import type { ReactNode } from "react";

export const container = "mx-auto max-w-[1180px] px-5 md:px-8";

// Every page but the home page: one column, the page's intro on top, the same room above and below.
export function Page({ children }: { children: ReactNode }) {
  return <div className={`${container} pb-24 pt-14 md:pb-32 md:pt-20`}>{children}</div>;
}

export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div className="max-w-[820px]">
      <p className="text-eyebrow font-semibold text-secondary">{eyebrow}</p>
      <h1 className="mt-3 text-headline font-semibold text-balance">{title}</h1>
      <p className="mt-6 max-w-[38em] text-intro text-secondary text-pretty">{children}</p>
    </div>
  );
}

export function Highlight({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-label">{children}</strong>;
}
