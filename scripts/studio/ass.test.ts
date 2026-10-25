import { expect, test } from "bun:test";
import { assColour, assDocument, assText, assTime } from "./ass";

test("writes libass styles and events in ASS's colour and time formats", () => {
  const doc = assDocument(
    1080,
    1920,
    [{ name: "Caption", font: "Avenir Next Condensed Heavy", size: 92, colour: "#FFFFFF", box: { colour: "#132257", opacity: 0.8, padding: 18 }, alignment: 2, marginV: 470 }],
    [
      { start: 1.874, end: 62.5, style: "Caption", text: assText("{\\b1}SOLANKE") },
      { start: 3, end: 3, style: "Caption", text: "EMPTY" },
    ],
  );
  const lines = doc.split("\n");
  expect(lines).toContain("PlayResY: 1920");
  const style = lines.find((l) => l.startsWith("Style: "))!.slice(7).split(",");
  // Name, font, size, primary, secondary, outline, back; BorderStyle 4 puts the box behind the event, padded by Shadow.
  expect(style.slice(0, 7)).toEqual(["Caption", "Avenir Next Condensed Heavy", "92", "&H00FFFFFF", "&H00FFFFFF", "&H00000000", "&H33572213"]);
  expect(style.slice(15, 18)).toEqual(["4", "0", "18"]);
  expect(style[21]).toBe("470");
  expect(lines.filter((l) => l.startsWith("Dialogue:"))).toEqual(["Dialogue: 0,0:00:01.87,0:01:02.50,Caption,,0,0,0,,b1SOLANKE"]);
});

test("converts colour, opacity and hour-long times", () => {
  expect(assColour("#E3262F", 0)).toBe("&HFF2F26E3");
  expect(assTime(3723.456)).toBe("1:02:03.46");
});
