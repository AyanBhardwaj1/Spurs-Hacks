import { afterEach, expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ io: async () => {} }));
const { matchLibrary, sourceExtras } = await import("./library");
const originalKey = process.env.SCOREPLAY_API_KEY;

afterEach(() => {
  mock.restore();
  if (originalKey === undefined) delete process.env.SCOREPLAY_API_KEY;
  else process.env.SCOREPLAY_API_KEY = originalKey;
});

test("with no ScorePlay key the studio says it is not connected and calls nothing", async () => {
  delete process.env.SCOREPLAY_API_KEY;
  const fetchMock = spyOn(globalThis, "fetch");
  expect(await matchLibrary()).toMatchObject({ ok: false, off: true });
  const extras = await sourceExtras(130852725, 6334, [131002615]);
  expect(extras.missing).toEqual({ posters: "off", club: "off", uploads: "off" });
  expect(extras.rendered).toEqual({});
  expect((await sourceExtras(130852725, 6334)).missing.uploads).toBeUndefined();
  expect(fetchMock).not.toHaveBeenCalled();
});
