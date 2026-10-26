# Demo script

This is the script the team used for judging on 23 October 2026. The event's platforms are gone now, so video does not play and approvals stay on the page. See "What works now" in the README.

For whoever presents Rundown to the judges. It is five minutes, spoken, keyed to the seven steps of the
studio's presenter. The figures come from the committed run (`src/lib/studio/data/mnu-tot.json`, recorded
23 October); if a new run replaces it, check them against the page before you go on.

## Before you start

- Open `/studio` on the laptop that will be projected, at 1440 wide. Mute the laptop.
- Type the site password into the browser's own prompt. A link with the password in it breaks search,
  approval and the presenter, because Chrome blocks the page's requests from a URL with credentials.
- Use a Chrome profile without video-downloader extensions: one of them puts an "MP4 File" badge over
  every video.
- Press **Present the demo** (bottom right). **→** or **PageDown** goes forward, **←** or **PageUp** goes
  back, **Esc** leaves. A clicker works.
- If the page reloads mid-demo, it comes back on the same step.
- Check that no clip says "Approved" or "Rejected" yet. If one does, press **Undo** on it, so the approval
  in step 7 is fresh.

## The five minutes

**Opening (15 s, before step 1)**

> A club films every second of a match and its social team turns a handful of moments into posts, by hand.
> Rundown watches the whole match, decides what is worth making, cuts it for each audience, and puts it in
> front of a producer to approve. This is Tottenham's real match against Manchester United, from the club's
> own library.

**Step 1 · The match, in the club's ScorePlay (30 s)**

> This is ScorePlay, where Tottenham keeps its media. The full match is 1 hour 45 minutes. Below it are the
> 57 videos Tottenham's team made from it by hand. We never gave Rundown those; we use them at the end to
> check our work.

Press →.

**Step 2 · The run (30 s)**

> Rundown read the match in 14 stages: the crowd's noise, the commentary, Twelve Labs to confirm moments on
> video, Claude to plan the clips. This is a sped-up replay of the recorded run; it took 13 minutes 34 seconds
> for the whole match. Each card shows what the stage did and how long it really took.

If the MatchWatch line shows under the stages: "The editorial review is built on MatchWatch, by Feria and
Hamid."

Press →.

**Step 3 · What it found (50 s)**

> It found 76 moments. Blue pins are ours; green marks are where Tottenham's editors cut. Twelve Labs saw 48
> of these moments on camera, not just in the commentary.

The monitor is playing the top moment, Solanke's equaliser in stoppage time. Then press the suggestion
**striker heads cross into far corner** under the Twelve Labs search:

> And you can ask the match anything in plain words. Twelve Labs puts the answers on the timeline.

Click the first result, at 1:36:59; it plays the equaliser.

Our Twelve Labs allowance ran out on the morning of the demo, so search answers from results recorded
before it ran out, and the page says so. A typed query gets recorded Twelve Labs results when a recorded
query covers all of its words. Otherwise it gets the run's own moments whose title, commentary or Pegasus
description mention those words, and the page labels them as that. The suggestions are still the safe
path, so press one of them on stage.

Press →.

**Step 4 · What it left out, and why (40 s)**

> A producer's first question is what it skipped. Here are the 93 candidates it weighed and dropped, each
> with a reason you can argue with. If it missed a gem, it is one click away.

> And because it can say why footage will never be used, that is a storage call too: about 23 minutes of
> this match nothing pointed at, so its master can go to cold storage.

Press →.

**Step 5 · Edits for each audience (40 s)**

> From the 76 moments it planned 18 clips. The biggest moments get several edits each: the goal, the
> reaction, the player, the build-up, in 9:16 and 1:1, cut for match fans, season ticket holders, a sponsor
> and international fans.

The "Edited in Reel Studio" row leads the step:

> The edits were finished in Reel Studio, with Claude Code doing the edit: plain cut on the left, Reel
> Studio's version on the right, with captions, a player card and the score. Both are in ScorePlay.

Press **Play both** on the first pair.

Press →.

**Step 6 · Checked against Tottenham's editors (40 s)**

> How do we know it picks the right moments? On this development match, 9 of our top 10 moments overlap
> clips and highlights Tottenham's team made by hand, each one checked by eye against the club's own frame.
> Same-length picks placed at random in the playing halves average 1.7. Picking the loudest crowd moments
> gets 2.5.

If asked how strict that is: "Against single-moment clips only, it is 4 of 10; a match has to overlap by at
least 3 seconds."

Press →.

**Step 7 · A producer approves, back in ScorePlay (45 s)**

> The system proposes; a person approves. 16 of these clips are already rendered and uploaded into
> ScorePlay, next to the match. Left is the plan, right is the file ScorePlay holds.

Press **Approve** on the first clip.

> That decision is now a tag on the clip in ScorePlay, where the club's team works. Rundown also wrote 30
> timecoded moments onto the match itself, so they can search it there.

**Close (10 s)**

> One match in, a ranked, checked set of edits out, and a producer who approves instead of searching.

## If the network fails (30 s)

The pages still open from the committed run, and the sections that need ScorePlay say it is slow and show
the recorded run. Video and search need the network, so talk over the page as it stands:

> Rundown watched Tottenham's full match against Manchester United in ScorePlay. It found 76 moments from
> the commentary, the crowd and Twelve Labs, dropped 93 candidates with a reason for each, and planned 18
> clips cut for four audiences, 16 of them rendered and uploaded back to ScorePlay for a producer to
> approve. On this match, 9 of its top 10 moments overlap clips Tottenham's team made by hand; random picks
> average 1.7.

## If a judge asks how a producer overrules it

Press **Make a clip anyway** on a row under "Ranked below the cut". The rescue lands as a timecoded log
tagged `rundown-rescued` on the match in ScorePlay, for the edit team to cut. Press it at most once per
candidate: ScorePlay returns no log IDs (`docs/engine.md`), so the studio cannot remove a log once it is
written.
