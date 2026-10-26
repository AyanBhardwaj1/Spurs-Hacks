# Agent guide

Rundown is a Next.js app built by Team 7 at the Spurs² Hackathon (Problem 1, Assisted Auto-Production) and continued here by Ayan alone. The README explains the product, what works without the event's platforms, and the content rules.

## Working here

- One person works in this repo. There is no coordination server, no bot review and no `gh` CLI.
- Branch from `main` as `ayan/<topic>`. One Conventional Commit per change, `type(scope): subject`, with scopes such as `studio`, `rundown`, `docs`, `agents` or `ci`.
- Before merging, run `bun run lint && bun run typecheck && bun run test && bun run build`. All four must pass. Then fast-forward `main` and push it. CI (`.github/workflows/ci.yml`) runs the same checks on the push. It has no API keys and never calls ScorePlay or Twelve Labs.

## The platforms are gone

The event's ScorePlay platform was wiped and the Twelve Labs allowance is spent. Treat both as unavailable. Keep the code that calls them, because it works again with a key. Every feature must also work without a key and say on the page what it could not do. Never present a write that did not happen as one that did.

The studio reads `src/lib/studio/data/mnu-tot.json`. Change it only through a script in `scripts/studio`, then run `bun scripts/studio/validate.ts`.

## Skills

`.claude/skills` holds the skills below; `.agents/skills` links to the same folder for other agents. Read the matching `SKILL.md` before the task.

| Task | Skill |
| --- | --- |
| Any prose: docs, UI copy, code comments, commit messages | `unslop` |
| README or other docs | `technical-writing` |
| Editing AGENTS.md or a skill, or briefing another agent | `prompt-writing` |
| Reviewing your diff | `deslop` |
| Committing (it runs `deslop` first) | `commit-changes` |
| Writing or changing a test | `test-audit` |

## Tests

Run them with `bun run test`. Put a test next to the code it covers as `<name>.test.ts` and import from `bun:test`. A test earns its place only when it pins logic with one correct answer and would fail if that logic broke: timecode and match-clock math, rights and eligibility rules, parsing ScorePlay or Twelve Labs responses. No snapshot tests, no tests of the framework. Fixtures hold hand-written IDs and metadata, never media.

## Rules

- Match media belongs to the clubs and leagues. You may download, clip, transform and render it, locally or in the cloud, to do the work. Keep it only while a job runs: write it to a temp directory or a gitignored `.media/` folder, delete it when the job finishes, and never commit, publish or re-host it. Store IDs, timecodes and metadata; put derived clips back into ScorePlay through its upload API.
- Keep API keys in `.env.local`. Call ScorePlay and Twelve Labs from server code only, never from the browser.
- Use bun for installs and scripts (`bun add`, `bun run`). Do not add a pnpm, npm or yarn lockfile.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
