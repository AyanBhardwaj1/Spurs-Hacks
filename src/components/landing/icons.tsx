import type { ReactNode } from "react";

// One stroke weight and cap style for every icon, so they read as a set next to San Francisco.

type IconProps = { className?: string };

function Icon({ className = "size-5", children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function VideoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="M16 10.5l5-3v9l-5-3" />
    </Icon>
  );
}

export function PhotoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.75" />
      <path d="M21 16l-5-5-8 8" />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 018 0v3" />
    </Icon>
  );
}

// Media controls are filled shapes, like the system's own play and pause glyphs.
export function PlayIcon({ className = "size-3.5" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path d="M4 2.6c0-.8.9-1.3 1.6-.9l8 5.2c.6.4.6 1.3 0 1.7l-8 5.2c-.7.4-1.6 0-1.6-.9Z" />
    </svg>
  );
}

export function PauseIcon({ className = "size-3.5" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="currentColor" className={className}>
      <rect x="3.5" y="2" width="3.4" height="12" rx="1" />
      <rect x="9.1" y="2" width="3.4" height="12" rx="1" />
    </svg>
  );
}

export function ReplayIcon({ className = "size-3.5" }: IconProps) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={className}>
      <path d="M3.2 6.2A5.6 5.6 0 1 1 2.6 10" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path d="M1.6 2.4v4.8h4.8Z" fill="currentColor" />
    </svg>
  );
}
