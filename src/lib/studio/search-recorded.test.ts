import { expect, test } from "bun:test";
import { matchRecordedSearch } from "./search-recorded";

test("example searches find the recorded red-card and equaliser moments", () => {
  const examples = [
    ["red card, players surround referee", "players surround referee arguing after red card", 4991.23],
    ["striker heads cross into far corner", "striker heads cross into far corner", 5819.92],
    ["players celebrating equaliser", "players celebrating equaliser near corner flag", 5827.63],
  ] as const;
  for (const [query, matchedQuery, start] of examples) {
    const result = matchRecordedSearch(query);
    expect(result?.query).toBe(matchedQuery);
    expect(result?.hits[0]?.start).toBeCloseTo(start, 2);
  }
});

test("requires every request token and rejects opposing near misses", () => {
  expect(matchRecordedSearch("referee sending off player")?.query).toContain("red card");
  expect(matchRecordedSearch("striker heads cross into near corner")).toBeNull();
  expect(matchRecordedSearch("assistant referee flags offside on right touchline")).toBeNull();
  expect(matchRecordedSearch("goalkeeper diving to make a score")).toBeNull();
  expect(matchRecordedSearch("players celebrating goal with away fans")).toBeNull();
  expect(matchRecordedSearch("referee showing yellow card to purple midfielder")).toBeNull();
  expect(matchRecordedSearch("striker heads cross into far corner United")).toBeNull();
  expect(matchRecordedSearch("purple spaceship juggling bananas")).toBeNull();
});
