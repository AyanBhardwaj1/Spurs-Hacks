import type { Aspect, CheckResult, MomentKind, Platform, Proposal, Sport } from "./types";

// What each platform accepts, and the house rules Rundown adds on top. The
// limits are the ones a post would fail on; check them against the platform's
// help pages before relying on one that has changed.

export type Placement = {
  platform: Platform;
  placement: string;
  aspect: Aspect;
  width: number;
  height: number;
  maxSeconds: number;
  /** Characters the caption may use. X counts its own way; see `xLength`. */
  captionLimit: number;
  /** Rundown's own cap, kept low so captions read as written by a person. */
  hashtagLimit: number;
  titleLimit?: number;
  /** Fractions of the height that the platform's own buttons and captions cover. Burned-in text stays out of them. */
  safeTop: number;
  safeBottom: number;
};

export const PLACEMENTS = {
  "instagram-reel": { platform: "Instagram", placement: "Reel", aspect: "9:16", width: 1080, height: 1920, maxSeconds: 180, captionLimit: 2200, hashtagLimit: 5, safeTop: 0.12, safeBottom: 0.3 },
  "instagram-feed": { platform: "Instagram", placement: "Feed video", aspect: "1:1", width: 1080, height: 1080, maxSeconds: 180, captionLimit: 2200, hashtagLimit: 5, safeTop: 0.05, safeBottom: 0.1 },
  tiktok: { platform: "TikTok", placement: "Video", aspect: "9:16", width: 1080, height: 1920, maxSeconds: 600, captionLimit: 4000, hashtagLimit: 5, safeTop: 0.1, safeBottom: 0.3 },
  "youtube-short": { platform: "YouTube", placement: "Short", aspect: "9:16", width: 1080, height: 1920, maxSeconds: 180, captionLimit: 5000, hashtagLimit: 3, titleLimit: 100, safeTop: 0.1, safeBottom: 0.25 },
  "youtube-video": { platform: "YouTube", placement: "Video", aspect: "16:9", width: 1920, height: 1080, maxSeconds: 43200, captionLimit: 5000, hashtagLimit: 3, titleLimit: 100, safeTop: 0.05, safeBottom: 0.12 },
  "x-video": { platform: "X", placement: "Post", aspect: "16:9", width: 1280, height: 720, maxSeconds: 140, captionLimit: 280, hashtagLimit: 2, safeTop: 0.05, safeBottom: 0.1 },
  "x-square": { platform: "X", placement: "Post", aspect: "1:1", width: 1080, height: 1080, maxSeconds: 140, captionLimit: 280, hashtagLimit: 2, safeTop: 0.05, safeBottom: 0.1 },
  "club-app": { platform: "Club app", placement: "Video", aspect: "16:9", width: 1920, height: 1080, maxSeconds: 600, captionLimit: 1000, hashtagLimit: 0, safeTop: 0.05, safeBottom: 0.1 },
  "club-app-vertical": { platform: "Club app", placement: "Story", aspect: "9:16", width: 1080, height: 1920, maxSeconds: 60, captionLimit: 500, hashtagLimit: 0, safeTop: 0.1, safeBottom: 0.2 },
  partner: { platform: "Partner", placement: "Delivery", aspect: "16:9", width: 1920, height: 1080, maxSeconds: 600, captionLimit: 1000, hashtagLimit: 0, safeTop: 0.05, safeBottom: 0.1 },
} as const satisfies Record<string, Placement>;

export function placementFor(platform: Platform, aspect: Aspect): Placement {
  const match = Object.values(PLACEMENTS).find((p) => p.platform === platform && p.aspect === aspect);
  if (!match) throw new Error(`Rundown has no ${aspect} placement on ${platform}`);
  return match;
}

/** Moments people stop caring about within the hour. */
const LIVE_KINDS: MomentKind[] = ["goal", "celebration", "card", "chance", "silence", "bench", "crowd", "away-end", "confrontation"];

/**
 * How long a piece stays worth posting. A goal clip on X is old news within
 * minutes; a YouTube explainer or a partner delivery is not.
 */
export function freshForMinutes(platform: Platform, kind: MomentKind): number | null {
  const live = LIVE_KINDS.includes(kind);
  switch (platform) {
    case "X":
      return live ? 10 : 60;
    case "TikTok":
      return live ? 90 : 360;
    case "Instagram":
      return live ? 180 : 720;
    case "Club app":
      return live ? 1440 : null;
    case "YouTube":
    case "Partner":
      return null;
  }
}

const DEFAULT_HASHTAGS: Record<Sport, string[]> = {
  soccer: ["#COYS", "#THFC"],
  basketball: ["#PorVida", "#GoSpursGo"],
};

export function clubHashtags(sport: Sport): string[] {
  const configured = process.env.RUNDOWN_HASHTAGS?.split(",").map((t) => t.trim()).filter(Boolean);
  return configured?.length ? configured.map((t) => (t.startsWith("#") ? t : `#${t}`)) : DEFAULT_HASHTAGS[sport];
}

/** X counts every link as 23 characters, whatever its length. */
export function xLength(text: string) {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
}

const captionLength = (p: Placement, text: string) => (p.platform === "X" ? xLength(text) : [...text].length);

/** Trims a caption at a word boundary so caption plus hashtags fit the platform. */
export function fitCaption(p: Placement, caption: string, hashtags: string[]) {
  const tags = hashtags.slice(0, p.hashtagLimit);
  const suffix = tags.length ? `\n\n${tags.join(" ")}` : "";
  const room = p.captionLimit - captionLength(p, suffix);
  let body = caption.trim();
  if (captionLength(p, body) > room) {
    const words = body.split(/\s+/);
    while (words.length && captionLength(p, `${words.join(" ")}...`) > room) words.pop();
    body = `${words.join(" ")}...`;
  }
  return { caption: `${body}${suffix}`, hashtags: tags };
}

/** The rules a package must pass before it can be handed off. */
export function checkPackage(
  p: Placement,
  pkg: { durationSec: number; caption: string; hashtags: string[]; title?: string },
  proposal: Pick<Proposal, "partner" | "platform">,
  /** Pegasus's call; undefined when it never looked at the moment. */
  brandSafe: boolean | undefined,
): CheckResult[] {
  const len = captionLength(p, pkg.caption);
  const checks: CheckResult[] = [
    {
      rule: "Length",
      ok: pkg.durationSec <= p.maxSeconds,
      detail: `${Math.round(pkg.durationSec)}s of a ${p.maxSeconds}s limit for ${p.platform} ${p.placement}`,
    },
    {
      rule: "Caption",
      ok: len <= p.captionLimit,
      detail: `${len} of ${p.captionLimit} characters`,
    },
    {
      rule: "Hashtags",
      ok: pkg.hashtags.length <= p.hashtagLimit,
      detail: `${pkg.hashtags.length} of ${p.hashtagLimit} allowed`,
    },
    {
      rule: "Brand safety",
      ok: brandSafe === true,
      detail:
        brandSafe === undefined
          ? "Pegasus has not looked at this moment, so nobody has checked it"
          : brandSafe
            ? "Pegasus found nothing the club would not post"
            : "Pegasus flagged this moment",
    },
  ];
  if (p.titleLimit !== undefined) {
    const titleLength = [...(pkg.title ?? "")].length;
    checks.push({ rule: "Title", ok: titleLength > 0 && titleLength <= p.titleLimit, detail: `${titleLength} of ${p.titleLimit} characters` });
  }
  if (proposal.platform === "Partner") {
    checks.push({
      rule: "Partner in frame",
      ok: Boolean(proposal.partner),
      detail: proposal.partner ? `${proposal.partner} is readable in the cut` : "No partner logo was read in the cut",
    });
  }
  return checks;
}
