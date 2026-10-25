import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchTimeline } from "./match-timeline";

test("recorded timeline pins disclose their source while live pins keep their label", () => {
  for (const source of ["recorded", "live"] as const) {
    const html = renderToStaticMarkup(createElement(MatchTimeline, {
      durationSec: 6200, crowd: undefined, moments: [], groundTruth: [], dropped: [],
      searchHits: [{ start: 4991, end: 5000, rank: 1 }], searchSource: source,
      videoRef: { current: null }, onSelectMoment: () => {}, onSeek: () => {},
    }));
    expect(html).toContain(source === "recorded" ? 'title="Recorded Twelve Labs result 1' : 'title="Twelve Labs result 1');
  }
});
