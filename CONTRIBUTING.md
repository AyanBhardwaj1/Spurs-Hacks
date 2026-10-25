# Contributing

Branch names, the commit and PR title format, and what earns a test are in [AGENTS.md](AGENTS.md). Your agent reads that file every session, and the rules there apply to you too.

## Set up Coordigent

Coordigent lets each agent see which files the others are in and message them. Set it up once per machine, before your first agent session in this repo.

Open item: the `coord` help output does not say how to install the CLI. Ask Sam until this section names the install command.

```sh
coord login      # approve this machine in your browser
coord connect    # run inside your clone; wires the agent clients on this machine to this repo
coord doctor     # checks each client and prints the fix for any that fail
coord status     # lists the agents and conflicts in this repo
```

Run `coord connect --clients claude-code,codex,cursor` to wire only the clients you use. Run `coord install <client>` to add one later. If `coord connect` edits a tracked file, leave that change out of your PR unless Sam asks for it.

## Pull requests

Keep a pull request focused. A larger change is fine when its parts belong together.

State what the old code did before describing the new behavior. Link the reviewed files where that helps. Show only changed UI behavior, list known gaps, and report commands that actually ran with their results.

The `size:*` label describes the effective diff. It is a review signal, not a merge gate. Do not set it by hand.

`main` is protected. Every change lands through a PR with a squash merge. CI and code review must pass, and every review thread must be resolved. No human approval is required, because the team is five people working in one room for two days. Ask someone to look before merging anything that touches the ScorePlay writeback.

### Code review

Two bots review PRs here. Codex reviews every PR, automatically when it opens and again whenever someone comments `@codex review`. CodeRabbit reviews every PR that changes anything besides Markdown. Its free tier allows a limited number of reviews per hour, so it often answers with a rate-limit notice that says when it can run again. Comment `@coderabbitai review` after that time.

The `Code review` status stays pending until the bots have reviewed the PR's current head commit. A push resets it. Fix or answer each comment and resolve its thread. The lead can add the `coderabbit: waived` label to stop waiting for CodeRabbit on an urgent PR. When Codex acknowledges a review request but never posts the review, the lead can add `codex: waived` to stop waiting for Codex. Each label skips only its own bot; CI and open threads still block the merge.

## Checks

| Check | Command | Runs on | Required |
| --- | --- | --- | --- |
| CI / Lint, typecheck, build | `bun run lint && bun run typecheck && bun run test && bun run build` | every PR and push to `main` | yes |
| PR title / Conventional Commits title | none, it reads the PR title | every PR | no |
| Code review | none, it reads the bots' reviews of the head commit | every PR, review and comment | yes |

`bun run test` passes when no test files exist. Bare `bun test` exits 1 in that case, so use the script.

CI has no API keys and never calls ScorePlay or Twelve Labs. A green run proves the app compiles and the tests pass, not that the integration works. Check the integration against your own `.env.local` and say what you ran in the PR.

PR Size labels each PR from its diff. Labels syncs `.github/labels.json` to GitHub when that file changes on `main`.
