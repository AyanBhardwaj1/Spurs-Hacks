import { describe, expect, test } from "bun:test";
import { alignClip, bestOverlap } from "./align";
import type { Cue } from "./srt";

const cue = (start: number, end: number, text: string): Cue => ({ index: 0, start, end, text });

// Hand-written commentary in the shape of the match transcript, with filler
// around the lines the clips quote so the matcher has something to reject.
const match: Cue[] = [
  cue(360, 366, "A difficult place to play when things are wrong."),
  cue(373, 376, "Chance! Solanke, what a save by Lammies."),
  cue(376, 383, "Spurs press won the ball, and what a chance inside the opening three minutes to lead this game."),
  cue(900, 906, "Long throw from Udogie, cleared by the first defender."),
  cue(4667, 4672, "Mbeumo turns and scores!"),
  cue(4672, 4681, "And this was always the problem for Spurs, that Manchester United might get their chance."),
  cue(5822, 5828, "Solanke tangling with Martínez, and it's gone into the net!"),
  cue(5828, 5833, "I don't quite believe it. Dominic Solanke will get the credit."),
];

describe("alignClip", () => {
  test("places a clip whose transcript spells names differently", () => {
    const clip = [
      cue(2, 5, "Chance. Solanke, what a save by Lamens."),
      cue(5, 12, "Spurs press won the ball, and what a chance inside the opening three minutes to lead this game."),
    ];
    const spans = alignClip(match, clip);
    expect(spans).toHaveLength(1);
    expect(spans[0].offset).toBeGreaterThan(369);
    expect(spans[0].offset).toBeLessThan(373);
  });

  test("splits a highlights package into one span per cut, in clip order", () => {
    const clip = [
      cue(0, 5, "Mbeumo turns and scores!"),
      cue(5, 14, "And this was always the problem for Spurs, that Manchester United might get their chance."),
      cue(15, 21, "Solanke tangling with Martinez, and its gone into the net!"),
      cue(21, 26, "I don't quite believe it. Dominic Solanke will get the credit."),
    ];
    const spans = alignClip(match, clip);
    expect(spans).toHaveLength(2);
    expect(Math.abs(spans[0].offset - 4667)).toBeLessThan(2);
    expect(Math.abs(spans[1].offset - 5807)).toBeLessThan(2);
  });

  test("finds nothing for a post-match interview", () => {
    const interview = [
      cue(0, 6, "Yeah, it was so good. A bit of relief and enjoyment as well."),
      cue(6, 12, "I missed a few chances, could have had probably three goals today."),
    ];
    expect(alignClip(match, interview)).toEqual([]);
  });
});

describe("bestOverlap", () => {
  const moments = [
    { id: "chance", start: 360, end: 390, peak: 373 },
    { id: "goal", start: 4650, end: 4690, peak: 4667 },
    { id: "replay", start: 4685, end: 4700, peak: 4690 },
  ];

  test("picks the moment the range overlaps longest", () => {
    expect(bestOverlap({ start: 4660, end: 4695 }, moments)?.id).toBe("goal");
  });

  test("matches nothing when the range only touches a moment's edge", () => {
    expect(bestOverlap({ start: 390, end: 400 }, moments)).toBeUndefined();
  });
});

test("best overlap rejects a sub-three-second match and accepts the boundary", () => {
  const moments = [{ id: "a", start: 0, end: 10, peak: 5 }];
  expect(bestOverlap({ start: 7.1, end: 15 }, moments)).toBeUndefined();
  expect(bestOverlap({ start: 7, end: 15 }, moments)?.id).toBe("a");
});
