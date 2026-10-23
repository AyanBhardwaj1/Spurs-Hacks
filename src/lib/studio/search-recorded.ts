import recorded from "./data/search-recorded.json";

const STOP_WORDS = new Set(["a", "an", "the", "to", "of", "in", "on", "at", "as", "with", "after", "for", "into"]);
const SYNONYMS: Record<string, string> = {
  celebrating: "celebrate", celebrates: "celebrate", celebration: "celebrate",
  showing: "show", shows: "show", heading: "head", heads: "head", header: "head",
  arguing: "argue", argues: "argue", argument: "argue",
  equalizer: "equaliser", supporters: "fan", fans: "fan", spurs: "spurs",
  saved: "save", saves: "save", saving: "save", scored: "score", scores: "score", scoring: "score",
  missed: "miss", misses: "miss", missing: "miss",
};
const OPPOSITES = [
  ["near", "far"], ["left", "right"], ["home", "away"], ["yellow", "red"],
  ["miss", "score"], ["save", "score"], ["united", "spurs"], ["ontarget", "offtarget"],
] as const;

// Accents are dropped so "Martínez" stays one word, and "on target" and "off target" become single
// opposing words, because "on" is a stop word and would otherwise vanish.
export function tokens(query: string): Set<string> {
  const words = query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:sent|send|sends|sending)\s+off\b/g, "red card")
    .replace(/\b(on|off)\s+target\b/g, "$1target")
    .match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((word) => !STOP_WORDS.has(word)).map((word) =>
    SYNONYMS[word] ?? (word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word),
  ));
}

function contradicts(wanted: Set<string>, candidate: Set<string>): boolean {
  return OPPOSITES.some(([left, right]) =>
    (wanted.has(left) && candidate.has(right)) || (wanted.has(right) && candidate.has(left)),
  );
}

const candidates = recorded.map((entry) => ({ entry, tokens: tokens(entry.query) }));

export function matchRecordedSearch(query: string) {
  const wanted = tokens(query);
  if (wanted.size === 0) return null;
  let best: (typeof recorded)[number] | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    if (contradicts(wanted, candidate.tokens)) continue;
    const overlap = [...wanted].filter((token) => candidate.tokens.has(token)).length;
    // Every distinctive request token must be present. Extra words in a recorded query are fine.
    if (overlap < 2 || overlap !== wanted.size) continue;
    const score = 2 * overlap / (wanted.size + candidate.tokens.size);
    if (score > bestScore) {
      best = candidate.entry;
      bestScore = score;
    }
  }
  return best;
}
