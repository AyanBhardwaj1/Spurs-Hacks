import { expect, test } from "bun:test";
import { parseCli } from "./cli";

test("a video and nothing else cuts it for the default platforms, titled by its file name", () => {
  expect(parseCli(["match.mp4"])).toEqual({
    ok: true,
    value: { video: "match.mp4", title: "match", sport: "other", placements: ["tiktok", "instagram-reel", "youtube-short", "x-video"], replay: false, out: "rundown-match" },
  });
});

test("every option, in either --name value or --name=value form", () => {
  const parsed = parseCli(["--sport", "tennis", "final.mov", "--platforms=tiktok,x-square", "--title", "The final", "--replay", "--colour", "#00aa55", "--logo", "logo.png", "--out", "clips", "--language", "spanish"]);
  expect(parsed).toEqual({
    ok: true,
    value: { video: "final.mov", title: "The final", sport: "tennis", placements: ["tiktok", "x-square"], replay: true, language: "Spanish", colour: "#00AA55", logo: "logo.png", out: "clips" },
  });
});

test("mistakes are named, so the user can fix them", () => {
  expect(parseCli([])).toMatchObject({ ok: false, error: expect.stringContaining("Usage") });
  expect(parseCli(["a.mp4", "--sport", "chess"])).toMatchObject({ ok: false, error: expect.stringContaining("chess") });
  expect(parseCli(["a.mp4", "--platforms", "tiktok,myspace"])).toMatchObject({ ok: false, error: expect.stringContaining("myspace") });
  expect(parseCli(["a.mp4", "--colour", "red"])).toMatchObject({ ok: false });
  expect(parseCli(["a.mp4", "--language", "elvish"])).toMatchObject({ ok: false, error: expect.stringContaining("elvish") });
  expect(parseCli(["a.mp4", "--frobnicate"])).toMatchObject({ ok: false, error: expect.stringContaining("--frobnicate") });
  expect(parseCli(["a.txt"])).toMatchObject({ ok: false });
  expect(parseCli(["a.mp4", "b.mp4"])).toMatchObject({ ok: false });
});
