# Agent guide

Rundown is a Next.js app for the Spurs² hackathon (Problem 1, Assisted Auto-Production). The README explains the product and the data rules. Five people's agents edit this repo at the same time.

## Coordinate through Coordigent

Coordigent shows each agent which files the others are in and carries messages between them. Its tools come from the `coordigent` MCP server. If they are missing, stop and point your person at "Set up Coordigent" in CONTRIBUTING.md.

- At session start, call `coordigent_session_register` with your current task, written as your branch plus the area you touch, such as `sam/workspace-ui: src/app/**`. Then read `coordigent_message_inbox`.
- When you switch tasks, call `coordigent_session_heartbeat` with the new task and read the inbox again.
- When a conflict warning names a file another agent is in, find that agent with `coordigent_session_list` and send it a `coordigent_message_send` saying what you plan to change, before you edit the file.
- When you change something every agent depends on, such as a shared type, an env variable, a script or a dependency, run `coord msg everyone "<text>"` with what changed, the branch, and what others must do.

## Skills

`.claude/skills` holds the skills below; `.agents/skills` links to the same folder for other agents. Read the matching `SKILL.md` before the task.

| Task | Skill |
| --- | --- |
| Any prose: docs, UI copy, code comments, commit messages | `unslop` |
| README, CONTRIBUTING or other docs | `technical-writing` |
| Editing AGENTS.md or a skill, or briefing another agent | `prompt-writing` |
| Reviewing your diff | `deslop` |
| Committing (it runs `deslop` first) | `commit-changes` |
| Branching, pushing and opening the PR for finished work | `ship-pr` |
| Watching an open PR through CI and CodeRabbit review until it's ready | `babysit` |
| PR title and body, using `.github/pull_request_template.md` | `pr-writing` |
| Writing or changing a test | `test-audit` |

## Branches, commits and PRs

- Pull `main` before you start and again before you push. Branch from it as `<your-name>/<topic>`.
- Write commit subjects and PR titles as Conventional Commits: `type(scope): subject`, such as `feat(workspace): add the match clock`. The scope is the area you touched, such as `workspace`, `scoreplay`, `twelvelabs`, `ci` or `agents`. `main` takes squash merges, which keep the PR title, or the commit subject when the PR has one commit. The PR title check flags anything else.
- Open a PR against `main`. Before you push, run `bun run lint && bun run typecheck && bun run test && bun run build`.
- Every PR waits for code review before it merges. Codex reviews when the PR opens; after each later push, comment `@codex review` once. Every PR that changes more than Markdown also needs CodeRabbit, unless Sam has added the `coderabbit: waived` label, which skips only the CodeRabbit wait; Codex, CI and every review thread still apply. If Codex acknowledges a review request but never posts the review, Sam can add `codex: waived`, which skips only the Codex wait. When it says it is rate-limited, wait for the time it gives, then comment `@coderabbitai review`. Address every comment from either bot: fix it, or reply with the evidence for leaving it, then resolve the thread. Leave a thread open when the finding needs Sam's decision, and tell him. Write `@codex` only in the review request comment itself, never in a PR description or any other comment: Codex treats any other mention as a request to run a cloud task.
- Squash-merge when `Lint, typecheck, build` and `Code review` are green and no review thread is open. The `babysit` skill runs this loop.
- Leave files outside your task alone. A merge conflict across five branches costs more than the cleanup was worth.

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
