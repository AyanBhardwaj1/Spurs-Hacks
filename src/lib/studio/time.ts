// Source time is seconds from the start of the ScorePlay asset. These format it for the studio's readouts.

const pad = (n: number) => String(n).padStart(2, "0");

/** "1:31:02" past an hour, "31:02" under it. Rounds down to the whole second, as a player's clock does. */
export function timecode(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** A clip's length, "0:24" or "2:05", rounded to the nearest second. */
export function clipLength(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** A pipeline stage's run time: "820 ms", "3.4 s", "2 min 05 s". */
export function stageTime(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${pad(s % 60)} s`;
}

/** A ScorePlay media name without its file extension, for titles. */
export function mediaTitle(name: string) {
  return name.replace(/\.(mp4|mov|mxf|m4v)$/i, "");
}
