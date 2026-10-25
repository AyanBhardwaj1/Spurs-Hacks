"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, type MouseEvent } from "react";
import { container } from "./page-parts";

const pill = "press inline-flex items-center rounded-full bg-button text-white hover:bg-button-hover";

const pages = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/proposals", label: "Proposals" },
  { href: "/built-on", label: "Built on" },
  { href: "/demo", label: "Sample run" },
];

// One bar on wider screens. On a phone the page links drop to a second row that scrolls sideways, so every
// page stays one tap away. The links come before "Try the demo" in the markup, so Tab follows the bar from
// left to right; on a phone the row of links moves below with order-last. The row's padding leaves room for
// the focus ring, which its sideways scrolling would otherwise clip.
export function SiteHeader() {
  const pathname = usePathname();
  // Next keeps the scroll position when the new page's top is already in view, so a header link would often
  // open the next page part-way down. The links turn that off and open every page at the top instead. Only a
  // header link sets this, so Back and Forward keep the browser's scroll restore.
  const openAtTop = useRef(false);

  useLayoutEffect(() => {
    if (!openAtTop.current) return;
    openAtTop.current = false;
    window.scrollTo(0, 0);
  }, [pathname]);

  const link = (href: string) => ({
    href,
    scroll: false,
    "aria-current": pathname === href ? ("page" as const) : undefined,
    onNavigate: () => {
      if (href !== pathname) openAtTop.current = true;
    },
    // A link to the page already open scrolls back to its top.
    onClick: (event: MouseEvent) => {
      if (href !== pathname || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    },
  });

  return (
    <header className="glass-bar sticky top-0 z-20">
      <nav aria-label="Pages" className={`${container} flex flex-wrap items-center gap-x-1 md:flex-nowrap`}>
        <Link {...link("/")} className="my-1 mr-auto flex h-11 items-center rounded-md text-title3 font-semibold">
          Rundown
        </Link>
        <div className="order-last -mx-4 flex w-full gap-1 overflow-x-auto px-1 pb-2 pt-1 md:order-none md:mx-0 md:w-auto md:overflow-visible md:p-0">
          {pages.map((page) => (
            <Link
              key={page.href}
              {...link(page.href)}
              className="press inline-flex h-8 shrink-0 items-center rounded-full px-3 text-caption pointer-coarse:h-11 text-label/80 hover:text-label aria-[current=page]:bg-fill aria-[current=page]:text-label"
            >
              {page.label}
            </Link>
          ))}
        </div>
        {/* The demo is the studio on the real match; /demo is the sample walkthrough, listed with the pages.
            The studio has its own layout, so this link leaves the header behind and keeps Next's own scroll to
            the top instead of link()'s. */}
        <Link
          href="/studio"
          className={`${pill} h-8 px-3.5 text-caption md:ml-3 pointer-coarse:h-11 pointer-coarse:px-4`}
        >
          Try the demo
        </Link>
      </nav>
    </header>
  );
}
