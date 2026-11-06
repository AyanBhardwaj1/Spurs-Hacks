import { expect, test } from "bun:test";
import { clipFocus, cropShare, focusExpr, limitPan } from "./focus";

test("the crop's share of the frame follows both shapes", () => {
  expect(cropShare({ width: 1920, height: 1080 }, { width: 1080, height: 1920 })).toBeCloseTo(0.3164, 4);
  expect(cropShare({ width: 1920, height: 1080 }, { width: 1080, height: 1080 })).toBeCloseTo(0.5625, 4);
  expect(cropShare({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBe(1);
  expect(cropShare({ width: 1080, height: 1920 }, { width: 1280, height: 720 })).toBe(1);
});

test("a wider crop is kept further from the edges", () => {
  const still = [{ pan: 0, cut: true }, { pan: 0, cut: false }];
  expect(limitPan([0.05, 0.05], still, 5, 0.4, 0.3164)[0]).toBeCloseTo(0.1582, 4);
  expect(limitPan([0.05, 0.05], still, 5, 0.4, 0.5625)[0]).toBeCloseTo(0.28125, 5);
});

test("the crop slides between keys in segment time and stays inside the frame", () => {
  expect(focusExpr([], 100)).toBe("min(max(iw*(0.5)-ow/2,0),iw-ow)");
  expect(focusExpr([{ t: 101, x: 0.3 }, { t: 103, x: 0.7 }], 100)).toBe(
    "min(max(iw*(if(lt(t,1),0.3,if(lt(t,3),0.3+(0.4000)*(t-1)/2.00,0.7)))-ow/2,0),iw-ow)",
  );
});

test("a clip's crop path takes each segment's keys from the moment played in it", () => {
  const moments = [
    { id: "a", peak: 100, focus: [{ t: 95, x: 0.2 }, { t: 130, x: 0.9 }] },
    { id: "b", peak: 300, focus: [{ t: 299, x: 0.7 }] },
    { id: "c", peak: 500 },
  ];
  expect(clipFocus({ momentId: "a", segments: [{ start: 90, end: 120 }] }, moments)).toEqual([{ t: 95, x: 0.2 }, { t: 130, x: 0.9 }]);
  expect(clipFocus({ momentId: "a", segments: [{ start: 97, end: 105 }, { start: 297, end: 305 }, { start: 497, end: 505 }] }, moments)).toEqual([{ t: 95, x: 0.2 }, { t: 299, x: 0.7 }]);
});
