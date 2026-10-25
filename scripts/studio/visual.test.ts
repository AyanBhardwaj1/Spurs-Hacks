import { describe, expect, test } from "bun:test";
import { evidenceFor, insideSource, rankStrength, unmatched, type Hit } from "./visual";

const hit = (query: string, start: number, end: number, rank: number): Hit => ({ query, start, end, rank });

describe("rankStrength", () => {
  test("is 1 at rank 1 and falls by 0.1 a place", () => {
    expect([1, 2, 5, 10, 11].map(rankStrength)).toEqual([1, 0.9, 0.6, 0.1, 0]);
  });
});

describe("insideSource", () => {
  test("drops ranges outside the source or running backwards", () => {
    const hits = [hit("q", 10, 20, 1), hit("q", -1, 5, 2), hit("q", 6330, 6340, 3), hit("q", 30, 30, 4)];
    expect(insideSource(hits, 6334)).toEqual({ valid: [hit("q", 10, 20, 1)], dropped: 3 });
  });
});

describe("evidenceFor", () => {
  const moment = { start: 5797, end: 5857 };

  test("takes each query's best-ranked hit within 10 s of the moment", () => {
    const hits = [hit("header", 5862, 5866, 4), hit("header", 5828, 5833, 2), hit("header", 1000, 1005, 1), hit("save", 5000, 5005, 1)];
    const evidence = evidenceFor(moment, ["header", "save"], hits);
    expect(evidence.map((e) => ({ at: e.at, strength: e.strength }))).toEqual([{ at: 5828, strength: 0.9 }]);
  });

  test("a hit just past the margin does not count", () => {
    expect(evidenceFor(moment, ["header"], [hit("header", 5868, 5875, 1)])).toEqual([]);
  });
});

describe("unmatched", () => {
  test("keeps hits away from every moment and merges overlapping ones", () => {
    const moments = [{ start: 100, end: 130 }];
    const hits = [hit("save", 135, 140, 1), hit("save", 900, 910, 3), hit("tackle", 905, 915, 2), hit("tackle", 2000, 2004, 5)];
    expect(unmatched(hits, moments)).toEqual([
      { start: 900, end: 915, queries: ["save", "tackle"], bestRank: 2 },
      { start: 2000, end: 2004, queries: ["tackle"], bestRank: 5 },
    ]);
  });
});
