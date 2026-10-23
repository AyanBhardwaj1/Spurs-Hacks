import type { SearchHit } from "./search";
import { tokens } from "./search-recorded";
import type { Moment, Player } from "./types";

// Searches the run's own moments when live Twelve Labs search has failed and no recorded query covers the
// request. Every request word must appear in the moment's title, kind, commentary summary, Pegasus
// description or tagged players. Words found in the title or kind count double, so "goal" ranks the goals
// above moments whose commentary only mentions one.
export function matchMoments(query: string, moments: Moment[], roster: Player[], limit = 10): SearchHit[] {
  const wanted = [...tokens(query)];
  if (wanted.length === 0) return [];
  const shortNames = new Map(roster.map((p) => [p.id, p.shortName]));
  const scored: { moment: Moment; score: number }[] = [];
  for (const moment of moments) {
    const strong = tokens(`${moment.title} ${moment.kind.replace(/-/g, " ")}`);
    const players = moment.players.map((id) => shortNames.get(id) ?? "").join(" ");
    const weak = tokens(`${moment.summary} ${moment.description ?? ""} ${players}`);
    if (!wanted.every((token) => strong.has(token) || weak.has(token))) continue;
    const score = wanted.reduce((sum, token) => sum + (strong.has(token) ? 2 : 1), 0);
    scored.push({ moment, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.moment.scores.total - a.moment.scores.total)
    .slice(0, limit)
    .map(({ moment }, i) => ({ start: moment.start, end: moment.end, rank: i + 1 }));
}
