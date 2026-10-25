// ScorePlay renders a video's "detailed" sprite sheets: numbered JPEGs, each a 10 x 6 grid of 256 x 144
// frames taken one second apart. Seen on media 130852725: 106 sheets (_0 to _105) of 2560 x 864 for its
// 6,334 s, and a 403 past the last sheet. The API returns only sheet _0 (`video.sprite_full`), so the
// others are named by swapping the index. The studio uses them for posters and the timeline's scrub
// preview, which shows the right frame without loading any video.

export type SpriteSheets = {
  /** Sheet URL with `{n}` where the sheet index goes. */
  template: string;
  durationSec: number;
};

export const SPRITE = { cols: 10, rows: 6, frameW: 256, frameH: 144, secondsPerFrame: 1 } as const;
const PER_SHEET = SPRITE.cols * SPRITE.rows;

/** Reads the sheet template from `video.sprite_full`, or undefined when the URL is not the shape described above. */
export function spriteSheets(spriteFull: string | undefined, durationSec: number): SpriteSheets | undefined {
  if (!spriteFull || !/_0\.jpg$/.test(spriteFull)) return undefined;
  return { template: spriteFull.replace(/_0\.jpg$/, "_{n}.jpg"), durationSec };
}

/** The sheet and the background position that show the frame at source second `t`. */
export function spriteFrame(sheets: SpriteSheets, t: number) {
  const last = Math.max(0, Math.floor(sheets.durationSec / SPRITE.secondsPerFrame) - 1);
  const frame = Math.min(last, Math.max(0, Math.floor(t / SPRITE.secondsPerFrame)));
  const sheet = Math.floor(frame / PER_SHEET);
  const cell = frame % PER_SHEET;
  const col = cell % SPRITE.cols;
  const row = Math.floor(cell / SPRITE.cols);
  return {
    url: sheets.template.replace("{n}", String(sheet)),
    // With the sheet sized to cols x rows of the box, these percentages land on one cell exactly.
    position: `${(col / (SPRITE.cols - 1)) * 100}% ${(row / (SPRITE.rows - 1)) * 100}%`,
    size: `${SPRITE.cols * 100}% ${SPRITE.rows * 100}%`,
  };
}
