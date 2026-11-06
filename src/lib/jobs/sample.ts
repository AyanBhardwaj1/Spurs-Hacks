// A synthetic match for trying Rundown with no video of your own: a moving test pattern with pink "crowd"
// noise that roars three times, at different strengths, so the ranking has something to show. No club or
// league footage is involved, so it is safe to generate, keep and share.

export const SAMPLE = {
  durationSec: 180,
  title: "Sample match: Rundown FC v Demo United",
  roars: [
    { at: 40, seconds: 7, gain: 7 },
    { at: 95, seconds: 6, gain: 5 },
    { at: 150, seconds: 9, gain: 9 },
  ],
} as const;

/** ffmpeg arguments that write the sample match to `output`. */
export function sampleMatchArgs(output: string): string[] {
  const d = SAMPLE.durationSec;
  const loudness = ["1", ...SAMPLE.roars.map((r) => `between(t,${r.at},${r.at + r.seconds})*${r.gain}`)].join("+");
  return [
    "-v", "error",
    "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=25:duration=${d}`,
    "-f", "lavfi", "-i", `anoisesrc=d=${d}:c=pink:a=0.04`,
    "-filter_complex", `[1:a]volume='${loudness}':eval=frame[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-c:a", "aac", "-shortest", "-y", output,
  ];
}
