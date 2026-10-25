// The environment for a child process (ffmpeg, ffprobe, git, Reel Studio). bun loads .env.local into
// process.env, so a child spawned with the default environment receives every API key in it. A child
// gets the environment without any *_API_KEY variable: none of them needs one, and an ANTHROPIC_API_KEY
// would make Claude Code bill it instead of the session's own sign-in.

export function childEnv(extra: Record<string, string> = {}, base: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) if (value !== undefined && !/_API_KEY$/i.test(key)) env[key] = value;
  return { ...env, ...extra };
}
