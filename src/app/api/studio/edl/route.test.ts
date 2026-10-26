import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { GET } = await import("./route");

test("serves a planned clip's EDL as a download named after the clip", async () => {
  const response = await GET(new Request("http://localhost/api/studio/edl?clip=c-m-5822-goal-goal"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/plain");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="c-m-5822-goal-goal.edl"');
  expect(await response.text()).toContain("001  AX       AA/V  C        01:36:52:00 01:37:26:00 01:00:00:00 01:00:34:00");
});

test("the recap downloads too, all 13 segments", async () => {
  const body = await (await GET(new Request("http://localhost/api/studio/edl?clip=c-recap-full-recap"))).text();
  expect(body.match(/^\d{3} {2}/gm)).toHaveLength(13);
});

test("refuses a missing or unknown clip", async () => {
  expect((await GET(new Request("http://localhost/api/studio/edl"))).status).toBe(400);
  expect((await GET(new Request("http://localhost/api/studio/edl?clip=nope"))).status).toBe(404);
});
