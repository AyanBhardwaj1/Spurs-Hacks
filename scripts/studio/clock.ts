/** Source seconds of the four whistles, read from the commentary. */
export type ClockAnchors = {
  firstHalfKickoff: number;
  halfTime: number;
  secondHalfKickoff: number;
  fullTime: number;
};

/**
 * Match clock at source second `t`, in the broadcast convention: the first
 * minute of play is 1', and time past 45 or 90 shows as added time ("45+2'").
 * Returns undefined before kickoff, during the break and after full time.
 */
export function matchClock(t: number, anchors: ClockAnchors): string | undefined {
  const half =
    t >= anchors.firstHalfKickoff && t < anchors.halfTime
      ? { kickoff: anchors.firstHalfKickoff, offset: 0 }
      : t >= anchors.secondHalfKickoff && t <= anchors.fullTime
        ? { kickoff: anchors.secondHalfKickoff, offset: 45 }
        : undefined;
  if (!half) return undefined;
  const minute = half.offset + Math.floor((t - half.kickoff) / 60) + 1;
  const regulation = half.offset + 45;
  return minute > regulation ? `${regulation}+${minute - regulation}'` : `${minute}'`;
}

/** Minutes of play at `t`, for weighting late moments; 0 before kickoff, 45 through the break, capped at 90. */
export function matchMinute(t: number, anchors: ClockAnchors): number {
  if (t < anchors.firstHalfKickoff) return 0;
  if (t < anchors.halfTime) return Math.min(45, (t - anchors.firstHalfKickoff) / 60);
  if (t < anchors.secondHalfKickoff) return 45;
  return Math.min(90, 45 + (t - anchors.secondHalfKickoff) / 60);
}
