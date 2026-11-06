import { expect, test } from "bun:test";
import { postText } from "./post";

test("a post is the caption, then the chapters a line each, then the hashtags", () => {
  expect(postText({ caption: "Big win", hashtags: ["a", "b"] })).toBe("Big win #a #b");
  expect(postText({ caption: "All the goals", hashtags: ["x"], chapters: [{ at: 0, label: "Opener" }, { at: 75, label: "Equaliser" }, { at: 3725, label: "Late one" }] })).toBe(
    "All the goals\n\n0:00 Opener\n1:15 Equaliser\n1:02:05 Late one\n\n#x",
  );
});
