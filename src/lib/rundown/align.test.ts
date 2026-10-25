import { describe, expect, test } from "bun:test";
import { alignMatchLog, broadcastOffset, matchTimeAt } from "./align";
import type { MatchLogEvent } from "./types";

// Kickoff at 15:00:00 and half time at 15:46:00. The second half kicks off at
// 16:01:00. The recording starts 300 s before kickoff and keeps only 60 s of
// the 15-minute break, so the second half starts at offset 300 + 2760 + 60 = 3120.
const log: MatchLogEvent[] = [
  { id: "ko", kind: "kickoff", period: 1, wallclock: "2026-10-22T15:00:00Z", players: [], text: "" },
  { id: "g1", kind: "goal", period: 1, wallclock: "2026-10-22T15:17:42Z", players: ["A"], text: "" },
  { id: "ht", kind: "halftime", period: 1, wallclock: "2026-10-22T15:46:00Z", players: [], text: "" },
  { id: "2h", kind: "second-half", period: 2, wallclock: "2026-10-22T16:01:00Z", players: [], text: "" },
  { id: "g2", kind: "goal", period: 2, wallclock: "2026-10-22T16:20:00Z", players: ["B"], text: "" },
  { id: "rc", kind: "red-card", period: 2, wallclock: "2026-10-22T16:30:00Z", players: ["C"], text: "" },
];
const event = (id: string) => log.find((e) => e.id === id) as MatchLogEvent;

describe("alignMatchLog", () => {
  test("anchors each half on its own goal when the recording drops the break", () => {
    // Goal hits from Marengo, a second or two off, plus a strong false positive.
    // The first-half goal is the strongest hit, but the second half cannot
    // start before the first one ends, so it must anchor on 4262.
    const alignment = alignMatchLog(log, [
      { start: 1363, strength: 0.9 },
      { start: 2500, strength: 0.5 },
      { start: 4262, strength: 0.85 },
    ]);
    expect(alignment).toBeDefined();
    const at = (id: string) => broadcastOffset(log, alignment!, event(id));
    expect(at("g1")).toBe(1363);
    expect(at("g2")).toBe(4262);
    // The red card ten minutes after the second goal lands ten minutes later.
    expect(at("rc")).toBe(4862);
  });

  test("a half without goals assumes the recording ran straight through", () => {
    const firstHalfOnly = log.filter((e) => e.id !== "g2");
    const alignment = alignMatchLog(firstHalfOnly, [{ start: 1362, strength: 0.9 }]);
    // 15:00 kickoff at offset 300, so 16:30 is 300 + 5400.
    expect(broadcastOffset(firstHalfOnly, alignment!, event("rc"))).toBe(5700);
  });

  test("gives up rather than guessing when no goal lines up", () => {
    expect(alignMatchLog(log, [])).toBeUndefined();
  });
});

describe("matchTimeAt", () => {
  // First half anchored at 301, second at 3122, as in the first alignMatchLog test.
  const alignment = alignMatchLog(log, [
    { start: 1363, strength: 0.9 },
    { start: 4262, strength: 0.85 },
  ])!;

  test("reads a broadcast offset as the minute a caption would show", () => {
    expect(matchTimeAt(log, alignment, 1363)).toEqual({ wallclock: "2026-10-22T15:17:42.000Z", period: 1, minute: 18, stoppage: 0 });
    expect(matchTimeAt(log, alignment, 4262)).toMatchObject({ period: 2, minute: 65, stoppage: 0 });
  });

  test("counts stoppage time past 45 instead of running on to 46", () => {
    // 45 minutes 30 seconds into the first half.
    expect(matchTimeAt(log, alignment, 301 + 2730)).toMatchObject({ period: 1, minute: 45, stoppage: 1 });
  });

  test("has no match time before kickoff", () => {
    expect(matchTimeAt(log, alignment, 100)).toBeUndefined();
  });
});
