import type { MomentKind, Sport } from "./types";

// Marengo queries that look for the moments a broadcast cut tends to miss.
// The brief names three: the bench losing it, the visiting supporters, and
// the second the venue goes quiet. `weight` is how much a hit counts before
// Pegasus has looked at it.

export type Probe = {
  kind: MomentKind;
  query: string;
  label: string;
  weight: number;
};

const shared: Probe[] = [
  { kind: "crowd", query: "home fans on their feet celebrating in the stands", label: "Home end erupts", weight: 0.9 },
  { kind: "away-end", query: "away supporters celebrating in the visiting section", label: "Away end", weight: 0.8 },
  { kind: "silence", query: "stadium falls silent, fans with hands on their heads in disbelief", label: "Venue goes quiet", weight: 0.85 },
  { kind: "bench", query: "substitutes jumping off the bench celebrating", label: "Bench loses it", weight: 0.9 },
  { kind: "coach", query: "head coach shouting and gesturing on the sideline", label: "Coach on the touchline", weight: 0.6 },
  { kind: "confrontation", query: "players pushing and arguing face to face", label: "Flashpoint", weight: 0.6 },
  { kind: "crowd", query: "child in the crowd wearing the team shirt reacting", label: "Young fan", weight: 0.55 },
  { kind: "press", query: "player or coach laughing at a press conference", label: "Press room moment", weight: 0.5 },
];

const soccer: Probe[] = [
  { kind: "goal", query: "the ball hits the back of the net for a goal", label: "Goal", weight: 1 },
  { kind: "celebration", query: "goal scorer runs to the corner flag and celebrates with teammates", label: "Goal celebration", weight: 0.95 },
  { kind: "chance", query: "shot hits the post or crossbar", label: "Woodwork", weight: 0.7 },
  { kind: "chance", query: "goalkeeper makes a diving save", label: "Big save", weight: 0.75 },
  { kind: "card", query: "referee shows a red card", label: "Red card", weight: 0.8 },
  { kind: "skill", query: "player dribbles past several defenders", label: "Solo run", weight: 0.7 },
  { kind: "celebration", query: "players applaud the fans at full time", label: "Full-time applause", weight: 0.6 },
  { kind: "sponsor", query: "close-up of a player with the shirt sponsor logo clearly visible", label: "Partner in frame", weight: 0.5 },
];

const basketball: Probe[] = [
  { kind: "skill", query: "slam dunk in transition on a fast break", label: "Transition dunk", weight: 1 },
  { kind: "goal", query: "three-point shot goes in and the bench stands up", label: "Three and the bench", weight: 0.9 },
  { kind: "skill", query: "player blocks a shot at the rim", label: "Block at the rim", weight: 0.85 },
  { kind: "skill", query: "behind-the-back or crossover dribble that leaves the defender stumbling", label: "Handles", weight: 0.75 },
  { kind: "celebration", query: "player flexes and screams after scoring an and-one", label: "And-one", weight: 0.8 },
  { kind: "coach", query: "timeout huddle with the coach drawing a play", label: "Timeout huddle", weight: 0.45 },
  { kind: "crowd", query: "arena crowd waving towels and cheering", label: "Arena noise", weight: 0.7 },
  { kind: "sponsor", query: "close-up of a player with the jersey patch sponsor logo visible", label: "Partner in frame", weight: 0.5 },
];

export function probesFor(sport: Sport): Probe[] {
  return [...(sport === "soccer" ? soccer : basketball), ...shared];
}

/** Turn a fan post into a Marengo query: drop handles, links, hashtag marks and emoji. */
export function fanPostToQuery(post: string): string {
  return post
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/@\w+/g, " ")
    .replace(/#(\w+)/g, "$1")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
