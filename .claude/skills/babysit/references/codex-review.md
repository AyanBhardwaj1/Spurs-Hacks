# Use Codex as the review gate

Read this when a watched repository has Codex code review, which shows up as `chatgpt-codex-connector[bot]` on its PRs. Codex's verdict decides when a fix loop ends. A caretaker's own judgment of whether the code now looks right does not.

## What Codex posts

- **Accepted:** an 👀 reaction on the PR or on the `@codex review` comment. The review has started; this is not a result.
- **Status:** a comment starting with `<!-- codex-pull-request-review-summary -->`. Codex edits it in place; its table gives each review's status, short commit SHA and trigger. This is the most reliable completion signal.
- **Findings:** a review whose body starts with `### 💡 Codex Review` and names `**Reviewed commit:**`, with one inline comment per finding. Each finding carries a priority badge, `P0` (most severe) through `P3`. A normal review reports only P0 and P1. With Exhaustive review turned on, P2 and P3 also appear. Fix P0 and P1 unless you can show they're wrong. Validate P2 and P3, then fix them or reply with a reason; they don't block readiness on their own.
- **Clean:** a 👍 reaction and no new review. The bot's footer says it "reacts with 👍 once all reviews finish with no findings."
- **Not reviewed:** a comment saying "You have reached your Codex usage limits for code reviews". The head was not reviewed. Report it as a blocker and name the account problem; never count it as a pass.

## Tie the verdict to the current head

- The status comment's commit, or a findings review's `commit_id`, must match the current `headRefOid`.
- A 👍 has no commit ID. It counts only if it arrived after your `@codex review` comment for the current head, and the head has not changed since. Record the comment URL, the head SHA and the reaction time together.
- An 👀 with nothing after it is pending, not clean.

## The loop

1. The repository reviews automatically only when a PR opens. After every push that changes the PR head (fixes, syncs with `main`, conflict resolutions), comment `@codex review` exactly once for the new head. Don't re-request for a head that already has a verdict or a pending 👀.
2. Validate each finding as you would any other review finding: fix it, or reply with the evidence for disagreeing. Use `gh api` on the review's inline comments; they are ordinary review threads.
3. Stop fixing when Codex gives 👍 for the current head, or when every P0 and P1 finding on the current head has a fix pushed or a reasoned reply.
4. If Codex raises the same finding again after you replied with evidence, stop and report it for a decision. Don't argue in a loop. The three-round limit in `SKILL.md` still applies.

Readiness under `SKILL.md` needs a Codex verdict for the current head. The `Code review` status checks this, but read the verdict yourself before merging.

## Don'ts

- Only `@codex review`, optionally followed by a focus (`@codex review for the migration`). Any other `@codex` text starts a cloud task that can push to the branch; never post one without the user's request. That includes PR descriptions: Codex reads an edited PR body that mentions it as a task request, so describe the review command in words there.
- Don't turn on per-push triggers or credits in Codex settings. Those are the account owner's decisions.
