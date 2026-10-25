import { expect, test } from "bun:test";
import { tagsFor } from "./taxonomy";

test("fails if a sending-off becomes a generic card or a disallowed goal becomes a goal", () => {
  expect(tagsFor({ kind: "card", title: "Bentancur is sent off", summary: "The referee shows a straight red card." })).toEqual(["Rundown", "Red card"]);
  expect(tagsFor({ kind: "disallowed-goal", title: "Goal ruled out", summary: "The flag is up." })).toEqual(["Rundown", "Disallowed goal"]);
});
