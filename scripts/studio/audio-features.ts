import { cached } from "./cache";
import type { AudioFeatures } from "./audio-align";

const RATE = 8000;
const FFT_SIZE = 2048;
const HOP = 800;
const BANDS = 16;
const VERSION = "log-spectrum-v1";

function spectrum(samples: Float64Array): number[] {
  const real = new Float64Array(FFT_SIZE);
  const imag = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) real[i] = samples[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
  for (let i = 1, j = 0; i < FFT_SIZE; i++) {
    let bit = FFT_SIZE >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let size = 2; size <= FFT_SIZE; size *= 2) {
    const angle = -2 * Math.PI / size;
    const wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < FFT_SIZE; start += size) {
      let r = 1, im = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = start + j, b = a + size / 2;
        const tr = r * real[b] - im * imag[b], ti = r * imag[b] + im * real[b];
        real[b] = real[a] - tr;
        imag[b] = imag[a] - ti;
        real[a] += tr;
        imag[a] += ti;
        const next = r * wr - im * wi;
        im = r * wi + im * wr;
        r = next;
      }
    }
  }
  const out: number[] = [];
  for (let b = 0; b < BANDS; b++) {
    const low = Math.ceil(120 * (3800 / 120) ** (b / BANDS) * FFT_SIZE / RATE);
    const high = Math.ceil(120 * (3800 / 120) ** ((b + 1) / BANDS) * FFT_SIZE / RATE);
    let power = 0;
    for (let k = low; k < high; k++) power += real[k] ** 2 + imag[k] ** 2;
    out.push(Math.log(1e-12 + power / (high - low)));
  }
  return out;
}

/** Decode to a pipe, retain only 10 Hz log-band energy changes. No media bytes are written to disk. */
export async function audioFeatures(id: number, url: string): Promise<AudioFeatures> {
  return (await cached(`audio/${id}-${VERSION}.json`, async () => {
    const proc = Bun.spawn([
      "ffmpeg", "-v", "error", "-nostdin", "-i", url,
      "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "pipe:1",
    ], { stdout: "pipe", stderr: "pipe" });
    const errors = new Response(proc.stderr).text();
    const ring = new Float64Array(FFT_SIZE);
    const values: number[] = [];
    let count = 0;
    let pendingByte: number | undefined;
    let previous: number[] | undefined;
    const consume = (low: number, high: number) => {
      const unsigned = low | (high << 8);
      ring[count % FFT_SIZE] = (unsigned >= 32768 ? unsigned - 65536 : unsigned) / 32768;
      count++;
      if (count < FFT_SIZE || (count - FFT_SIZE) % HOP !== 0) return;
      const ordered = new Float64Array(FFT_SIZE);
      for (let i = 0; i < FFT_SIZE; i++) ordered[i] = ring[(count + i) % FFT_SIZE];
      const current = spectrum(ordered);
      // Temporal differences remove static spectral colour and gain; music or retimed audio must still pass the measured correlation gate.
      for (let b = 0; b < BANDS; b++) values.push(previous ? current[b] - previous[b] : 0);
      previous = current;
    };
    const reader = proc.stdout.getReader();
    try {
      for (;;) {
        const { value: bytes, done } = await reader.read();
        if (done) break;
        let i = 0;
        if (pendingByte !== undefined && bytes.length) {
          consume(pendingByte, bytes[0]);
          pendingByte = undefined;
          i = 1;
        }
        for (; i + 1 < bytes.length; i += 2) consume(bytes[i], bytes[i + 1]);
        if (i < bytes.length) pendingByte = bytes[i];
      }
      const code = await proc.exited;
      const error = await errors;
      if (code !== 0) throw new Error(`Audio decode ${id} exited ${code}: ${error}`);
      if (values.length < BANDS * 40) throw new Error(`Audio decode ${id} produced less than four seconds of features`);
      return { stepSec: HOP / RATE, bands: BANDS, values };
    } finally {
      reader.releaseLock();
      if (proc.exitCode === null) proc.kill();
      await proc.exited;
    }
  })).value;
}

if (import.meta.main) {
  const { getMedia } = await import("./scoreplay");
  for (const id of process.argv.slice(2).map(Number)) {
    const media = await getMedia(id);
    if (!media.video?.proxy_medium) throw new Error(`Media ${id} has no proxy_medium`);
    const features = await audioFeatures(id, media.video.proxy_medium);
    console.log(`${id}: ${features.values.length / features.bands} feature frames`);
  }
}
