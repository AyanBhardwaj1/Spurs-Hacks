---
name: babysit
description: 'Watch a PR or related PR stack until merge or closure, coordinate CI and review fixes, and squash-merge once CI and code review pass. Use for "babysit #N", "watch this stack", or "keep these PRs green".'
---

# Babysit a PR

Keep watching until the PR merges or closes, the user cancels, or another caretaker accepts the handoff. In this repository the caretaker merges: once the PR is ready (below), squash-merge it with `gh pr merge <number> --squash --match-head-commit <head-sha>`, using the head you checked, so a push that lands in between makes the merge fail instead of shipping an unreviewed commit. Never enable auto-merge.

The caretaker needs a session that can run a background command, because the watcher below wakes it. One caretaker can own several related PRs. If another teammate's agent is still writing to a branch, don't push to it; send that agent the finding through Coordigent instead.

## Assess and fix

Fetch the current PR state through `gh`. Use [PR state queries](references/pr-state.md) for paginated review threads and required checks. Record the head SHA.

Two bots review here, and the required `Code review` status reports whether both have finished with the current head:

- **Codex** reviews every PR. Follow the [Codex review gate](references/codex-review.md): after each fix push, comment `@codex review` once, and end the fix loop on Codex's verdict for the current head. If Codex acknowledges the request but never posts a review, tell Sam; only he adds the `codex: waived` label, which skips that wait and nothing else.
- **CodeRabbit** reviews every PR that changes more than Markdown. The lead-only `coderabbit: waived` label skips that wait and nothing else: Codex, CI and open threads still block the merge. When it posts a rate-limit notice, wait the time it names, then comment `@coderabbitai review` once. Its free tier allows roughly one review an hour across the repository, so batch your fixes into one push before asking again. Its findings count exactly like Codex's.

Check conflicts against the actual PR base, diagnose failing checks, and read full review discussions. Validate each finding against current code and behavior before fixing it. Distinguish defects from stale findings, false positives and unrelated improvements. Keep uncertain findings visible.

Fix supported, in-scope defects, run affected checks, commit and push normally. Reply with the fix SHA or a concise reason for disagreement or deferral. Do not resolve threads merely to pass this workflow. Send substantial fixes to the existing implementer; caretaker edits require writer ownership.

After every push, refresh the head, required checks and review threads. Changed heads invalidate readiness. After three unsuccessful fix rounds on a PR, pause further fixes and report the blocker for a decision. Keep watching while awaiting that decision; unchanged feedback does not authorize another fix round.

## Watch

Watch every assigned PR with one shared watcher, started through Bash with `run_in_background`:

```sh
node .claude/skills/babysit/scripts/pr-watch.mjs SamGu-NRX/spurs-hackathon#12,14
```

It makes one GitHub query for all targets every three minutes and exits only on a change you must act on: a check failing, all checks finishing, new reviews or comments, a changed unresolved-thread count, head, base, draft or merge state, a merge or closure. Its exit wakes the session, so an idle PR costs no turns. Do not watch PRs with Monitor, which stops after 30 minutes and wakes you to re-arm it, costing a full turn each time. Do not write your own watcher either.

End every turn with the watcher running; never sleep or poll inside a turn. After acting on its output, start the same command again. Its baseline persists per working directory, so a change that lands while you work is still reported. Your own push or reply also counts as a change: start with `--rebaseline` only immediately after you have re-read the PR state yourself.

Other exits: `ALL_DONE` means every target is merged or closed, so stop. `NO_CHANGE` after 23 hours means start it again. `COVERAGE_LOST`, exit 2, means GitHub failed for 30 minutes: report lost coverage, then start it again. A not-found target means fix the list.

Keep the watch active after readiness and while fixes await a decision. Remove merged or closed PRs from the targets. On cancellation or an accepted handoff, stop the background task and tell the new caretaker which targets it now owns.

## Readiness and reports

When fixes change the PR's scope, behavior or evidence, update its description under [pr-writing](../pr-writing/SKILL.md). Preserve the body's author ownership and bot-managed sections.

A PR is ready when it is open and not draft, its current head passes `Lint, typecheck, build` and `Code review`, no unresolved threads or actionable feedback remain, and the merge state is clean. Pending or unknown evidence is not a pass. Then merge it.

Report the merge, or a decision needed, once. Include relevant SHAs, finding dispositions and remaining blockers without repeating prior history. A coverage failure must say the watch has stopped.

## Boundaries

A babysitting request authorizes in-scope fixes, commits, pushes and review replies. Ask only for a user-owned decision or an action outside existing authorization. Rebase or force-push requires explicit authorization; conflicts do not grant it.

Never bypass hooks or required checks, weaken tests to obtain a pass, mark a PR ready on your own, or reopen a closed PR.

`ship-pr` hands off open PRs here.

Adapted from [Andrew Wang's astack babysit skill](https://github.com/andrewwbuilds/astack/blob/0505e9d/claude/skills/babysit/SKILL.md).
