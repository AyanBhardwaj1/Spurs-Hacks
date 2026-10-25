import type { ReactNode } from "react";

// The three window controls in macOS's colors. They are drawn, not working, so they stay hidden from
// screen readers.
export function TrafficLights() {
  return (
    <span aria-hidden className="flex shrink-0 gap-2">
      <span className="size-3 rounded-full bg-[#ff5f57] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.22)]" />
      <span className="size-3 rounded-full bg-[#febc2e] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.22)]" />
      <span className="size-3 rounded-full bg-[#28c840] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.22)]" />
    </span>
  );
}

export function WindowFrame({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] bg-grouped text-left shadow-[0_40px_90px_-30px_rgb(0_0_0/0.35)]">
      <div className="relative flex h-11 items-center px-4">
        <TrafficLights />
        <div className="absolute inset-x-20 truncate text-center text-footnote font-semibold">{title}</div>
      </div>
      {children}
    </div>
  );
}
