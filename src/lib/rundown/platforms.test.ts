import { describe, expect, test } from "bun:test";
import { fitCaption, PLACEMENTS, xLength } from "./platforms";

describe("fitCaption", () => {
  test("an X caption with a link and hashtags still fits 280 as X counts it", () => {
    // X counts the short link as 23 characters, more than its real length.
    const long = `https://t.co/eq ${"The equaliser from behind the goal, and the noise that came with it. ".repeat(6)}`;
    const { caption, hashtags } = fitCaption(PLACEMENTS["x-video"], long, ["#COYS", "#THFC", "#PremierLeague"]);
    expect(xLength(caption)).toBeLessThanOrEqual(280);
    expect(hashtags).toEqual(["#COYS", "#THFC"]);
    expect(caption.endsWith("#COYS #THFC")).toBe(true);
    // Cut at a word, not mid-word.
    expect(caption.split("\n\n")[0]).toMatch(/\w\.\.\.$/);
  });

  test("a caption that already fits is left alone", () => {
    const { caption } = fitCaption(PLACEMENTS["instagram-reel"], "You were there for this.", ["#COYS"]);
    expect(caption).toBe("You were there for this.\n\n#COYS");
  });
});
