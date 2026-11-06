import type { JobSport } from "./types";

// What Rundown needs to know about a sport to cut it: what its commentators shout when something
// happens, how close together two separate plays can be, and the hashtags its fans search. Everything
// else (the crowd, the camera cuts, the platforms) works the same for every sport.

export type SportProfile = {
  label: string;
  /** Two roars closer than this are one play. Short for sports where points come quickly. */
  gapSec: number;
  /** Phrases this sport's commentators use for a big moment, lower case, on top of the shared ones. */
  calls: string[];
  tags: string[];
};

/** Calls any commentator makes, whatever the sport. */
export const SHARED_CALLS = [
  "what a", "oh my", "unbelievable", "incredible", "sensational", "stunning", "brilliant", "amazing", "wow",
  "he's done it", "she's done it", "they've done it", "look at that", "are you kidding", "you have to see",
];

export const SPORT: Record<JobSport, SportProfile> = {
  soccer: {
    label: "Soccer",
    gapSec: 20,
    calls: ["goal", "goals", "scores", "scored", "red card", "penalty", "save", "saves", "free kick", "header", "volley", "top corner", "off the bar"],
    tags: ["football", "soccer", "goal", "matchday", "highlights"],
  },
  basketball: {
    label: "Basketball",
    gapSec: 10,
    calls: ["dunk", "slam", "three pointer", "from downtown", "and one", "buzzer", "game winner", "alley oop", "block", "rejected", "crossover", "bang"],
    tags: ["basketball", "hoops", "nba", "highlights", "buckets"],
  },
  "american-football": {
    label: "American football",
    gapSec: 25,
    calls: ["touchdown", "interception", "pick six", "fumble", "sacked", "sack", "field goal", "is good", "first down", "he's gone", "house call"],
    tags: ["nfl", "football", "touchdown", "gameday", "highlights"],
  },
  "ice-hockey": {
    label: "Ice hockey",
    gapSec: 15,
    calls: ["goal", "scores", "save", "glove save", "breakaway", "power play", "hat trick", "top shelf", "five hole", "shorthanded"],
    tags: ["hockey", "nhl", "icehockey", "goal", "highlights"],
  },
  baseball: {
    label: "Baseball",
    gapSec: 25,
    calls: ["home run", "it's gone", "grand slam", "strike three", "struck him out", "double play", "walk off", "diving catch", "outta here", "base hit"],
    tags: ["baseball", "mlb", "homerun", "gameday", "highlights"],
  },
  tennis: {
    label: "Tennis",
    gapSec: 8,
    calls: ["ace", "winner", "break point", "set point", "match point", "game set", "passing shot", "what a rally", "drop shot", "lob", "tiebreak"],
    tags: ["tennis", "atp", "wta", "rally", "highlights"],
  },
  cricket: {
    label: "Cricket",
    gapSec: 20,
    calls: ["six", "wicket", "bowled", "caught", "century", "hundred", "lbw", "stumped", "run out", "boundary", "hat trick"],
    tags: ["cricket", "wicket", "six", "matchday", "highlights"],
  },
  rugby: {
    label: "Rugby",
    gapSec: 20,
    calls: ["try for", "goes over", "scores", "drop goal", "conversion", "big hit", "tackle", "line break", "intercept", "penalty", "over the line"],
    tags: ["rugby", "try", "rugbyunion", "matchday", "highlights"],
  },
  volleyball: {
    label: "Volleyball",
    gapSec: 8,
    calls: ["kill", "spike", "block", "ace", "stuff", "dig", "set point", "match point", "what a rally", "pancake"],
    tags: ["volleyball", "spike", "volley", "rally", "highlights"],
  },
  combat: {
    label: "Boxing or MMA",
    gapSec: 15,
    calls: ["knockout", "knocked out", "knock down", "he's down", "she's down", "tko", "submission", "taps", "takedown", "left hook", "right hand", "stopped"],
    tags: ["boxing", "mma", "ufc", "knockout", "fight"],
  },
  motorsport: {
    label: "Motorsport",
    gapSec: 20,
    calls: ["overtake", "goes past", "crash", "into the wall", "spins", "takes the lead", "chequered flag", "checkered flag", "pole position", "fastest lap", "side by side"],
    tags: ["motorsport", "racing", "f1", "overtake", "highlights"],
  },
  esports: {
    label: "Esports",
    gapSec: 10,
    calls: ["ace", "clutch", "pentakill", "quadra kill", "triple kill", "team wipe", "one tap", "headshot", "baron", "steal", "gg"],
    tags: ["esports", "gaming", "clutch", "gg", "highlights"],
  },
  other: {
    label: "Another sport",
    gapSec: 20,
    calls: [],
    tags: ["sports", "highlights", "gameday", "replay", "clip"],
  },
};

/** The calls Rundown listens for in a sport. "Another sport" listens for every sport's. */
export function callsFor(sport: JobSport): string[] {
  const own = sport === "other" ? Object.values(SPORT).flatMap((p) => p.calls) : SPORT[sport].calls;
  return [...new Set([...SHARED_CALLS, ...own])];
}
