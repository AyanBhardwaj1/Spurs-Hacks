import type { JobClip } from "./types";

/** h:mm:ss past an hour, m:ss under it: how YouTube reads a chapter's time. */
function chapterTime(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const mmss = `${Math.floor(s / 60) % 60}:${String(s % 60).padStart(2, "0")}`;
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mmss.padStart(5, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The text to paste with a clip: its caption, its chapters if it has them, and its hashtags. */
export function postText(clip: Pick<JobClip, "caption" | "hashtags" | "chapters">): string {
  const tags = clip.hashtags.map((h) => `#${h}`).join(" ");
  if (!clip.chapters?.length) return [clip.caption, tags].filter(Boolean).join(" ");
  const chapters = clip.chapters.map((c) => `${chapterTime(c.at)} ${c.label}`).join("\n");
  return [clip.caption, chapters, tags].filter(Boolean).join("\n\n");
}
