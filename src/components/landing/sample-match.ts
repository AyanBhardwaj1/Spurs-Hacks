// Illustrative rows for the landing page. None of these come from the match data.
// Signal sources and audiences follow the engine's types in src/lib/rundown/types.ts on the engine branch.

export type Signal = "Footage" | "Match log" | "Fans" | "Archive";

export type Proposal = {
  id: string;
  tc: string;
  moment: string;
  source: string;
  why: string;
  signal: Signal;
  audience: string;
  format: string;
};

export type Spike = {
  id: string;
  tc: string;
  moment: string;
  source: string;
  reason: string;
};

export const proposals: Proposal[] = [
  {
    id: "equaliser",
    tc: "00:17:42",
    moment: "Equaliser, home end reaction",
    source: "ISO camera behind the goal",
    why: "The broadcast cut to the scorer. The ISO kept the crowd.",
    signal: "Footage",
    audience: "Season ticket holders",
    format: "9:16 · 0:14",
  },
  {
    id: "red-card",
    tc: "00:58:10",
    moment: "Red card and the bench reaction",
    source: "Broadcast and bench camera",
    why: "Fans were arguing about the call before the club had a clip out. Captions explain the rule.",
    signal: "Fans",
    audience: "First-time viewers abroad",
    format: "16:9 · 0:40",
  },
  {
    id: "presser",
    tc: "Post",
    moment: "Manager on the red card",
    source: "Press conference",
    why: "The line people are already quoting, cut to a single answer.",
    signal: "Fans",
    audience: "Social editors",
    format: "1:1 · 0:20",
  },
  {
    id: "partner",
    tc: "00:31:05",
    moment: "Build-up with the shirt partner in frame",
    source: "Broadcast",
    why: "The logo is readable for the whole move, which is what a partner deal asks for.",
    signal: "Footage",
    audience: "Main partner",
    format: "16:9 · 0:30",
  },
  {
    id: "full-time",
    tc: "01:46:20",
    moment: "Players thank the home end at full time",
    source: "Bench camera",
    why: "The match log puts full time here. Nobody filmed it for the broadcast, but the bench camera kept rolling.",
    signal: "Match log",
    audience: "Families",
    format: "4:5 · 0:20",
  },
];

export const spikes: Spike[] = [
  {
    id: "replay",
    tc: "00:58:14",
    moment: "Wide replay of the same foul",
    source: "Broadcast",
    reason: "Same moment as the red card proposal, from a worse angle.",
  },
  {
    id: "crowd",
    tc: "01:12:30",
    moment: "Crowd close-up",
    source: "Match photos",
    reason: "A child fills the frame. Not worth the image-rights risk.",
  },
];

// The sample broadcast runs to 01:50:00. Post-match material sits in its own slot at the end.
const BROADCAST_SECONDS = 110 * 60;

export function timelinePosition(tc: string) {
  if (tc === "Post") return 96;
  const seconds = tc.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  return (seconds / BROADCAST_SECONDS) * 88;
}
