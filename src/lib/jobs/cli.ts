import { DEFAULT_PLACEMENTS, JOB_PLACEMENTS, LANGUAGES, SPORTS, type JobPlacement, type JobSport, type Language } from "./types";

// The command line's arguments. Pure, so the tests can pin them; scripts/rundown.ts does the work.

export const USAGE = `Usage: bun run rundown <video> [options]

  --sport <name>         ${SPORTS.join(", ")} (default: other)
  --platforms <a,b>      ${JOB_PLACEMENTS.join(", ")}
                         (default: ${DEFAULT_PLACEMENTS.join(",")})
  --title <text>         the match's name (default: the file name)
  --replay               end each short clip with a slow-motion replay
  --language <name>      write the copy in ${LANGUAGES.join(", ")} (needs OPENAI_API_KEY)
  --colour <#RRGGBB>     the colour the caption word being said turns
  --logo <file>          a PNG or JPEG laid over every clip and cover
  --out <folder>         where the clips, covers and manifest go (default: rundown-<file name>)`;

export type CliJob = {
  video: string;
  title: string;
  sport: JobSport;
  placements: JobPlacement[];
  replay: boolean;
  language?: Language;
  colour?: string;
  logo?: string;
  out: string;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const VIDEO = /\.(mp4|mov|m4v|mkv|webm|ts|mts)$/i;
const FLAGS = new Set(["sport", "platforms", "title", "colour", "color", "logo", "out", "language"]);

export function parseCli(argv: string[]): Parsed<CliJob> {
  const opts: Record<string, string> = {};
  const videos: string[] = [];
  let replay = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      videos.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq < 0 ? undefined : arg.slice(eq + 1);
    if (name === "replay") {
      replay = true;
      continue;
    }
    if (!FLAGS.has(name)) return { ok: false, error: `Unknown option --${name}.\n\n${USAGE}` };
    const value = inline ?? argv[++i];
    if (value === undefined) return { ok: false, error: `--${name} needs a value.` };
    opts[name === "color" ? "colour" : name] = value;
  }
  if (videos.length !== 1) return { ok: false, error: videos.length ? `Give one video at a time, not ${videos.length}.` : USAGE };
  const [video] = videos;
  if (!VIDEO.test(video)) return { ok: false, error: `${video} is not a video file Rundown reads: mp4, mov, m4v, mkv, webm or ts.` };

  const sport = opts.sport ?? "other";
  if (!SPORTS.includes(sport as JobSport)) return { ok: false, error: `No sport called "${sport}". Pick one of ${SPORTS.join(", ")}.` };
  const placements = opts.platforms ? opts.platforms.split(",").map((p) => p.trim()).filter(Boolean) : DEFAULT_PLACEMENTS;
  const unknown = placements.filter((p) => !JOB_PLACEMENTS.includes(p as JobPlacement));
  if (unknown.length || placements.length === 0) return { ok: false, error: `No platform called ${unknown.join(", ") || "(none)"}. Pick from ${JOB_PLACEMENTS.join(", ")}.` };
  if (opts.colour !== undefined && !/^#[0-9a-f]{6}$/i.test(opts.colour)) return { ok: false, error: "--colour must be a hex colour such as #FFD60A." };
  const language = opts.language && LANGUAGES.find((l) => l.toLowerCase() === opts.language.toLowerCase());
  if (opts.language && !language) return { ok: false, error: `No language called "${opts.language}". Pick one of ${LANGUAGES.join(", ")}.` };

  const base = video.split("/").at(-1)!.replace(VIDEO, "");
  return {
    ok: true,
    value: {
      video,
      title: opts.title ?? base,
      sport: sport as JobSport,
      placements: [...new Set(placements as JobPlacement[])],
      replay,
      ...(language && language !== "English" && { language }),
      ...(opts.colour && { colour: opts.colour.toUpperCase() }),
      ...(opts.logo && { logo: opts.logo }),
      out: opts.out ?? `rundown-${base}`,
    },
  };
}
