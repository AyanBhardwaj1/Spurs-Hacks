import type { Anchor } from "./focus";

// What the vision model is asked about sampled frames, and how its answer is read. One mark per frame:
// where across the picture a narrow crop should be centred. Anything it gets wrong in shape is dropped
// here, and the shared focus rules carry the crop across frames with no mark.

export const ANCHOR_SYSTEM = [
  "You locate the action in frames from a sports broadcast or recording so that a narrow vertical crop can follow it.",
  "For each frame, give x: the horizontal position from 0 (left edge) to 1 (right edge) where the crop should be centred.",
  "Use the ball or puck when you can see it. Otherwise use the players contesting it or the space it is heading into.",
  "In a close-up, use the person in focus. In a crowd or bench shot, use the person or group the shot is about.",
  "Ignore scoreboards, logos and on-screen text. Say whether the ball is visible.",
].join(" ");

export const ANCHOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["frames"],
  properties: {
    frames: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["frame", "x", "ballVisible"],
        properties: { frame: { type: "integer" }, x: { type: "number" }, ballVisible: { type: "boolean" } },
      },
    },
  },
} as const;

export type AnchorAnswer = { frames: { frame: number; x: number; ballVisible: boolean }[] };

export function isAnchorAnswer(value: unknown): value is AnchorAnswer {
  const frames = (value as AnchorAnswer | null)?.frames;
  return Array.isArray(frames) && frames.every((f) => typeof f?.frame === "number" && typeof f.x === "number" && typeof f.ballVisible === "boolean");
}

/** One mark per frame from 0 to count - 1. A frame missing, repeated or out of range gets none; x is clamped to 0..1. */
export function anchorsFrom(answer: AnchorAnswer, count: number): Anchor[] {
  const marks: Anchor[] = new Array(count).fill(undefined);
  const seen = new Set<number>();
  for (const f of answer.frames) {
    if (!Number.isInteger(f.frame) || f.frame < 0 || f.frame >= count) continue;
    // A frame answered twice means the model lost track of which frame is which; trust neither answer.
    if (seen.has(f.frame)) {
      marks[f.frame] = undefined;
      continue;
    }
    seen.add(f.frame);
    marks[f.frame] = { x: Math.min(1, Math.max(0, f.x)), ballVisible: f.ballVisible };
  }
  return marks;
}
