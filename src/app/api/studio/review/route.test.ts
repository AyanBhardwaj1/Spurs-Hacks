import { afterEach, expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));
const { POST } = await import("./route");
const originalKey = process.env.SCOREPLAY_API_KEY;

afterEach(() => {
  mock.restore();
  if (originalKey === undefined) delete process.env.SCOREPLAY_API_KEY;
  else process.env.SCOREPLAY_API_KEY = originalKey;
});

test("without a ScorePlay key, a decision is refused as offline so the page can hold it, and nothing is called", async () => {
  delete process.env.SCOREPLAY_API_KEY;
  const fetchMock = spyOn(globalThis, "fetch");
  // 131002615 is the rendered upload of c-m-5822-goal-goal in the committed run.
  const response = await POST(
    new Request("http://localhost/api/studio/review", { method: "POST", body: JSON.stringify({ mediaId: 131002615, decision: "approved" }) }),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ offline: true });
  expect(fetchMock).not.toHaveBeenCalled();
});
