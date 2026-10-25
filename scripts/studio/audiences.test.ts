import { expect, test } from "bun:test";
import { audienceRationale, sponsorVerification } from "./audiences";

test("fails if sponsor verification uses another moment's footage or stale copy", () => {
  const top = { start: 90, peak: 100, end: 130, title: "Kudus scores the opener", kind: "goal" as const };
  const shots = [{ start: 105.25, end: 110.5 }, { start: 110.5, end: 120.75 }, { start: 5827, end: 5844 }];
  expect(sponsorVerification(top, shots, [{ start: 95, end: 125 }])).toEqual({ range: { start: 105.25, end: 120.75 }, cacheKey: "pegasus/sponsor-105-120.json" });
  expect(() => sponsorVerification(top, shots, [{ start: 90, end: 101 }])).toThrow(top.title);
  expect(audienceRationale(top, "international", "")).toContain(top.title);
  expect(audienceRationale(top, "international", "")).not.toContain("Solanke");
  expect(sponsorVerification({ start: 5797.3, peak: 5821.968, end: 5856.968, title: "Equaliser" }, [
    { start: 5827.63330078125, end: 5833.23291015625 }, { start: 5833.23291015625, end: 5844.16650390625 }, { start: 5844.16650390625, end: 5851.23291015625 },
  ], [{ start: 5805, end: 5850 }]).cacheKey).toBe("pegasus/sponsor-5827-5844.json");
});
