import { expect, test } from "bun:test";
import { anchorsFrom, isAnchorAnswer } from "./anchors";

test("the vision answer's shape is checked before it is used", () => {
  expect(isAnchorAnswer({ frames: [{ frame: 0, x: 0.4, ballVisible: true }] })).toBe(true);
  expect(isAnchorAnswer({ frames: [{ frame: 0, x: "left", ballVisible: true }] })).toBe(false);
  expect(isAnchorAnswer({})).toBe(false);
});

test("each frame gets its mark; a missing, repeated or out-of-range mark is no mark, and x is clamped", () => {
  const marks = anchorsFrom(
    { frames: [{ frame: 0, x: 0.42, ballVisible: true }, { frame: 2, x: 1.3, ballVisible: false }, { frame: 7, x: 0.5, ballVisible: true }, { frame: 0, x: 0.9, ballVisible: true }] },
    4,
  );
  // Frame 0 is answered twice, so neither answer is trusted.
  expect(marks).toEqual([undefined, undefined, { x: 1, ballVisible: false }, undefined]);
  expect(anchorsFrom({ frames: [{ frame: 1, x: 0.42, ballVisible: true }] }, 2)).toEqual([undefined, { x: 0.42, ballVisible: true }]);
});
