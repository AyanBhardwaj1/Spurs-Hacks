import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TimelineSearch, type Found } from "./timeline-search";

test("recorded search banners identify the actual fallback reason", () => {
  for (const [reason, explanation] of [
    ["allowance", "live search allowance used up"],
    ["timeout", "live search timed out"],
    ["network", "live search connection failed"],
  ] as const) {
    const found: Found = { query: "red card", source: "recorded", reason, matchedQuery: "referee showing a red card", hits: [] };
    const html = renderToStaticMarkup(createElement(TimelineSearch, { found, onFound: () => {}, onSeek: () => {}, frameSource: "https://cdn.scoreplay.io/match.mp4" }));
    expect(html).toContain("Recorded Twelve Labs results for");
    expect(html).toContain(explanation);
    if (reason !== "allowance") expect(html).not.toContain("live search allowance used up");
  }
});

test("results from the run's own moments are labelled as such, not as Twelve Labs finds", () => {
  const found: Found = { query: "goal", source: "moments", reason: "allowance", hits: [{ start: 5797.3, end: 5830, rank: 1 }] };
  const html = renderToStaticMarkup(createElement(TimelineSearch, { found, onFound: () => {}, onSeek: () => {}, frameSource: "https://cdn.scoreplay.io/match.mp4" }));
  expect(html).toContain("Live Twelve Labs search allowance used up; these are moments from this run");
  expect(html).toContain("among the run’s moments");
  expect(html).not.toContain("Twelve Labs found");
});

test("recorded hits without thumbnails show the match's frame at each start, requesting one frame at a time", () => {
  const found: Found = {
    query: "header",
    source: "recorded",
    reason: "allowance",
    matchedQuery: "striker heads cross into far corner",
    hits: [
      { start: 5819.5, end: 5826, rank: 1 },
      { start: 3628, end: 3634, rank: 2 },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(TimelineSearch, { found, onFound: () => {}, onSeek: () => {}, frameSource: "https://cdn.scoreplay.io/match.mp4" }),
  );
  expect(html).toContain('src="https://cdn.scoreplay.io/match.mp4#t=5819.5"');
  expect(html).not.toContain("#t=3628");
});

test("searches answered without a Twelve Labs key say so, and an empty answer is not blamed on Twelve Labs", () => {
  const render = (found: Found) =>
    renderToStaticMarkup(createElement(TimelineSearch, { found, onFound: () => {}, onSeek: () => {}, frameSource: "https://cdn.scoreplay.io/match.mp4" }));
  expect(render({ query: "red card", source: "recorded", reason: "no-key", matchedQuery: "referee showing a red card", hits: [{ start: 4999, end: 5005, rank: 1 }] })).toContain(
    "no Twelve Labs key on this server",
  );
  expect(render({ query: "goal", source: "moments", reason: "no-key", hits: [{ start: 5797.3, end: 5830, rank: 1 }] })).toContain(
    "No Twelve Labs key on this server; these are moments from this run",
  );
  const empty = render({ query: "purple spaceship", source: "moments", reason: "no-key", hits: [] });
  expect(empty).toContain("No Twelve Labs key on this server, and nothing recorded or in this run’s moments matches");
  expect(empty).not.toContain("Twelve Labs found nothing");
  expect(empty).not.toContain("these are moments from this run");
});
