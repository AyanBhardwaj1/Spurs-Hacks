import { expect, test } from "bun:test";
import { cropShare, focusExpr, limitPan } from "./focus";

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
