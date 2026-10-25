import { describe, expect, test } from "bun:test";
import { decisionOf, decisionTagsIn, tagChanges } from "./review-tags";

describe("review tags", () => {
  test("reads both decision tags at once as a conflict, not a decision", () => {
    const present = decisionTagsIn(["rundown", "rundown-rejected", "rundown-approved", undefined]);
    expect(present).toEqual(["approved", "rejected"]);
    expect(decisionOf(present)).toEqual({ decision: null, conflict: true });
  });

  test("clearing a conflict removes both tags and adds none", () => {
    expect(tagChanges(["approved", "rejected"], null)).toEqual({ remove: ["approved", "rejected"], add: [] });
  });

  test("deciding during a conflict keeps that tag and removes the other", () => {
    expect(tagChanges(["approved", "rejected"], "rejected")).toEqual({ remove: ["approved"], add: [] });
  });

  test("switching a decision swaps the tags, and repeating it changes nothing", () => {
    expect(tagChanges(["approved"], "rejected")).toEqual({ remove: ["approved"], add: ["rejected"] });
    expect(tagChanges(["approved"], "approved")).toEqual({ remove: [], add: [] });
    expect(tagChanges([], null)).toEqual({ remove: [], add: [] });
  });
});
