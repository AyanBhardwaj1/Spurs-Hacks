import { describe, expect, test } from "bun:test";
import { matchClock, matchMinute, type ClockAnchors } from "./clock";

const anchors: ClockAnchors = { firstHalfKickoff: 300, halfTime: 3020, secondHalfKickoff: 3080, fullTime: 6400 };

describe("matchClock", () => {
  test("counts the first minute of play as 1'", () => {
    expect(matchClock(300, anchors)).toBe("1'");
    expect(matchClock(359.9, anchors)).toBe("1'");
    expect(matchClock(360, anchors)).toBe("2'");
  });

  test("shows time past 45 and 90 as added time", () => {
    expect(matchClock(300 + 45 * 60 + 5, anchors)).toBe("45+1'");
    expect(matchClock(3080, anchors)).toBe("46'");
    expect(matchClock(3080 + 46 * 60 + 2, anchors)).toBe("90+2'");
  });

  test("has no clock before kickoff, during the break or after full time", () => {
    expect(matchClock(299, anchors)).toBeUndefined();
    expect(matchClock(3050, anchors)).toBeUndefined();
    expect(matchClock(6401, anchors)).toBeUndefined();
  });
});

describe("matchMinute", () => {
  test("holds at 45 through the break and caps at 90", () => {
    expect(matchMinute(3050, anchors)).toBe(45);
    expect(matchMinute(6300, anchors)).toBe(90);
  });
});
