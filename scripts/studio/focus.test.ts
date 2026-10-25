import { describe, expect, test } from "bun:test";
import { CROP_WIDTH, cameraShift, focusKeys, limitPan, mergeRefinedFocus, pathFromAnchors, type Step } from "./focus";

describe("cameraShift", () => {
  test("measures a camera pan as the shift that lines the frames up", () => {
    const [w, h] = [160, 90];
    // A textured "pitch" whose content moves 3 px right and 1 px down between frames.
    const texture = (x: number, y: number) => ((x * 37 + y * 101) % 97) + ((x * x + 3 * y) % 13) * 5;
    const a = new Float32Array(w * h);
    const b = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        a[y * w + x] = texture(x, y);
        b[y * w + x] = texture(x - 3, y - 1);
      }
    }
    const shift = cameraShift(a, b, w, h);
    expect({ dx: shift.dx, dy: shift.dy, diff: shift.diff }).toEqual({ dx: 3, dy: 1, diff: 0 });
  });
});

const still = (n: number, cutsAt: number[] = []): Step[] =>
  Array.from({ length: n }, (_, i) => ({ pan: 0, cut: i === 0 || cutsAt.includes(i) }));

describe("pathFromAnchors", () => {
  test("carries anchors with the camera's pan and blends them between", () => {
    // The camera pans so content moves 0.02 frame widths right per frame.
    const motion: Step[] = [0, 0.02, 0.02, 0.02, 0.02].map((pan, i) => ({ pan, cut: i === 0 }));
    const path = pathFromAnchors(motion, [0.5, undefined, undefined, undefined, 0.6]);
    // Frame k is 0.5 + 0.02k carried forward and 0.6 - 0.02(4 - k) carried back, weighted k/4 towards the back.
    expect(path.map((x) => Math.round(x * 1000) / 1000)).toEqual([0.5, 0.525, 0.55, 0.575, 0.6]);
  });

  test("does not carry an anchor across a cut, and holds the last position through a shot without one", () => {
    const path = pathFromAnchors(still(6, [2, 4]), [0.3, undefined, 0.8, undefined, undefined, undefined]);
    expect(path).toEqual([0.3, 0.3, 0.8, 0.8, 0.8, 0.8]);
  });
});

describe("limitPan", () => {
  test("pans at most the speed limit inside a shot but jumps at a cut", () => {
    const half = CROP_WIDTH / 2;
    const smooth = limitPan([0.3, 0.7, 0.7], still(3), 5, 0.5);
    expect(smooth.map((x) => Math.round(x * 100) / 100)).toEqual([0.3, 0.4, 0.5]);
    const jumped = limitPan([0.3, 0.7, 0.95], still(3, [1]), 5, 0.5);
    expect(jumped[1]).toBe(0.7);
    expect(jumped[2]).toBeCloseTo(Math.min(0.8, 1 - half));
  });
});

describe("focusKeys", () => {
  test("keeps all four anchors per second instead of thinning the refined path", () => {
    expect(focusKeys(still(20), [0.4, 0.41, 0.42, 0.43].map((x) => ({ x, ballVisible: true })), 5819, 20, 4)).toEqual([
      { t: 5819, x: 0.4 },
      { t: 5819.25, x: 0.41 },
      { t: 5819.5, x: 0.42 },
      { t: 5819.75, x: 0.43 },
    ]);
  });
});

test("dense focus prefers confirmed balls within a shot and keeps close-up anchors after a cut", () => {
  const anchors = [
    { x: 0.4, ballVisible: true },
    { x: 0.8, ballVisible: false },
    { x: 0.3, ballVisible: true },
    { x: 0.28, ballVisible: true },
    ...Array.from({ length: 4 }, () => ({ x: 0.8, ballVisible: false })),
  ];
  expect(focusKeys(still(40, [20]), anchors, 0, 20, 4).map((k) => k.x)).toEqual([
    0.4, 0.35, 0.3, 0.28, 0.28, 0.8, 0.8, 0.8, 0.8,
  ]);
});

test("joining a refinement removes an old key that would violate the pan-speed limit", () => {
  expect(mergeRefinedFocus([
    { t: 5818.3, x: 0.5 }, { t: 5818.9, x: 0.579 }, { t: 5819.5, x: 0.607 }, { t: 5826.1, x: 0.597 },
  ], { start: 5819, end: 5826, keys: [{ t: 5819, x: 0.42 }, { t: 5825.75, x: 0.55 }] })).toEqual([
    { t: 5818.3, x: 0.5 }, { t: 5819, x: 0.42 }, { t: 5825.75, x: 0.55 }, { t: 5826.1, x: 0.597 },
  ]);
});
