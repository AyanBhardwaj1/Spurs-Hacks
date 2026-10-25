// A minimal writer for ASS subtitle files, which ffmpeg's `ass` filter
// (libass) burns into the video. ASS gives per-event timing, boxes, fades and
// scale transforms, which drawtext cannot animate.

export type AssStyle = {
  name: string;
  font: string;
  size: number;
  /** "#RRGGBB" text colour. */
  colour: string;
  /** Text outline, and the box colour with BorderStyle 3. */
  outline?: { colour: string; opacity?: number; width: number };
  /**
   * A box behind the whole event (libass BorderStyle 4): `colour` at `opacity`,
   * padded by `padding` pixels. Without it the text has an outline only.
   */
  box?: { colour: string; opacity: number; padding: number };
  /** Numpad alignment: 2 is bottom centre, 5 middle centre, 7 top left. */
  alignment: number;
  marginH?: number;
  marginV?: number;
  spacing?: number;
};

export type AssEvent = { start: number; end: number; style: string; text: string; layer?: number };

/** "#RRGGBB" and an opacity from 0 to 1 to ASS's &HAABBGGRR, where AA is transparency. */
export function assColour(hex: string, opacity = 1): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Not a #RRGGBB colour: "${hex}"`);
  const [, r, g, b] = match;
  const alpha = Math.round((1 - opacity) * 255).toString(16).padStart(2, "0");
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

/** "#RRGGBB" as an override tag's colour, &HBBGGRR&; opacity goes in a separate \1a tag. */
export const colourTag = (hex: string) => `${assColour(hex).replace(/^&H00/, "&H")}&`;

/** Seconds to ASS's H:MM:SS.cc. */
export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Literal text for an event: braces would open an override block and a backslash an escape. */
export const assText = (text: string) => text.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();

function styleLine(s: AssStyle): string {
  const borderStyle = s.box ? 4 : 1;
  const outline = s.outline ?? { colour: "#000000", width: 0 };
  const back = s.box ? assColour(s.box.colour, s.box.opacity) : "&H00000000";
  // With BorderStyle 4, libass pads the box by the Shadow value.
  const shadow = s.box ? s.box.padding : 0;
  return [
    `Style: ${s.name}`, s.font, s.size, assColour(s.colour), assColour(s.colour),
    assColour(outline.colour, outline.opacity ?? 1), back,
    0, 0, 0, 0, 100, 100, s.spacing ?? 0, 0, borderStyle, outline.width, shadow,
    s.alignment, s.marginH ?? 0, s.marginH ?? 0, s.marginV ?? 0, 1,
  ].join(",");
}

export function assDocument(width: number, height: number, styles: AssStyle[], events: AssEvent[]): string {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles.map(styleLine),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events
      .filter((e) => e.end > e.start)
      .map((e) => `Dialogue: ${e.layer ?? 0},${assTime(e.start)},${assTime(e.end)},${e.style},,0,0,0,,${e.text}`),
    "",
  ].join("\n");
}
