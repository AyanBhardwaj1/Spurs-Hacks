import { expect, test } from "bun:test";
import { reviewAction } from "./review-keys";

test("J and K move between clips and stop at the ends; nothing is chosen yet means the first", () => {
  expect(reviewAction("j", -1, 5)).toEqual({ move: 0 });
  expect(reviewAction("j", 2, 5)).toEqual({ move: 3 });
  expect(reviewAction("j", 4, 5)).toEqual({ move: 4 });
  expect(reviewAction("k", 0, 5)).toEqual({ move: 0 });
  expect(reviewAction("K", 3, 5)).toEqual({ move: 2 });
});

test("A and R decide the chosen clip and move on; U undoes and stays", () => {
  expect(reviewAction("a", 1, 5)).toEqual({ press: "approve", move: 2 });
  expect(reviewAction("r", 4, 5)).toEqual({ press: "reject", move: 4 });
  expect(reviewAction("u", 1, 5)).toEqual({ press: "undo" });
  expect(reviewAction("a", -1, 5)).toBeUndefined();
  expect(reviewAction("x", 1, 5)).toBeUndefined();
  expect(reviewAction("j", -1, 0)).toBeUndefined();
});
