# Rundown

Rundown turns a full match video, from any sport, into clips cut for each social platform. Upload the game, and it finds the moments from the crowd and the commentary, cuts each one differently for TikTok, Reels, Shorts, X and YouTube, writes the captions, and puts every clip in front of you to approve. It also lists what each platform left out, with a reason, so you can rescue the clip it got wrong.

It started at the Spurs² Hackathon (UT Austin, October 22 to 23, 2026) as a tool for Problem 1 of the [builder brief](https://scoreplay.notion.site/Spurs-Hackathon-Builder-Brief-3fb9d8f0d4ce815096d4dc8294142346), Assisted Auto-Production, built on the [ScorePlay](https://developer.scoreplay.io/) and [Twelve Labs](https://docs.twelvelabs.io/) APIs with Tottenham Hotspur's full match against Manchester United. That run is still in the studio as a case study.

## Make clips from any match

Open `/studio`, press **Upload a match**, and pick the platforms. No video to hand? **Try a sample match** makes a synthetic three-minute game on the server and runs the whole pipeline on it. Each platform gets its own cut:

| Platform | Shape | Cut | Moments |
| --- | --- | --- | --- |
| TikTok | 9:16 | opens 8 s before the roar, 14 to 26 s | top 5 |
| Instagram Reels | 9:16 | 15 to 21 s, short enough to loop | top 4 |
| YouTube Shorts | 9:16 | 22 to 44 s, with the build-up and the reaction | top 4 |
| X | 16:9 and 1:1 | 14 to 20 s, newsy | top 3 |
| YouTube | 16:9 | one highlights cut of the top 8 moments | 1 |

It runs with no keys: moments come from the crowd's noise, and the copy follows rules. Add `OPENAI_API_KEY` and it also transcribes the commentary, which finds moments the crowd missed and captions every clip, the vertical and square crops follow the play instead of staying centred, and the model writes each platform's hook and caption. Once a job is done you can move any clip's start and end and render it again, or cut the same match for platforms you skipped, without uploading it again. Every clip gets a cover image cut from its play, with the hook on it. Captions light up word by word as they are said, and short clips can end with a slow-motion replay of the play. Add your club's logo and colour and every clip and cover carries them. "Download approved" puts every approved clip, its cover, its captions and its post copy in one zip with a manifest. [docs/jobs.md](docs/jobs.md) covers how each stage works, the rules, and the settings.

### From the command line

The same pipeline runs with no server and no browser:

```bash
bun run rundown match.mp4 --sport tennis --platforms tiktok,x-video --replay --logo logo.png
```

It prints each stage as it finishes, then copies every clip, its cover and captions, `posts.txt` and `manifest.json` to `rundown-match/` (or `--out`), and names the clip to post first on each platform. The job stays in the studio, where you can review, trim or add platforms. `bun run rundown` with no arguments lists the options.

## Team and this repo

Team 7 built Rundown: Feria, Hamid, Sam, Ayan and Bryan. Feria and Hamid built the MatchWatch prompts the studio uses. The team's repository, with each person's commits, is `SamGu-NRX/spurs-hackathon`.

This repo imports that code as one commit and carries it on. Every commit after the import is Ayan's:

| Commit | What it does |
| --- | --- |
| `docs(readme)` describe the studio as built | The first honest README for the shipped studio |
| `fix(studio)` show the confirmed writeback | The run's last stage reports the 30 logs ScorePlay confirmed, not "Rehearsal" |
| `feat(studio)` storage call | Step 4 shows the stretches of the match nothing pointed at, as a cold-storage proposal |
| `feat(studio)` log a rescued candidate | "Make a clip anyway" writes a timecoded `rundown-rescued` log onto the match |
| `fix(studio)` answer typed searches from the run's moments | Search falls back to the run's 76 moments, and "shot on target" stops matching "off target" |
| `chore(agents)` one person's project | Retires the five-agent coordination, the PR bots and their workflows |
| `fix(studio)` search without a Twelve Labs key | Search works on a fresh clone, from recorded results and then the run's moments |
| `feat(studio)` edit decision lists | Every planned clip downloads as a CMX 3600 EDL for Premiere, Resolve or Avid |
| `fix(studio)` decisions without ScorePlay | Approve, Reject and rescues work offline, held on the page and labelled as not written |
| `fix(studio)` say why the footage is dark | The page says ScorePlay is not connected and explains the missing video |
| `feat(jobs)` moments from any match | Crowd-noise peaks and commentary calls, fused into ranked moments that snap to camera cuts |
| `feat(jobs)` a cut for every platform | Per-platform cuts, counts, captions and hashtag limits, with the model's copy held to them |
| `feat(jobs)` the engine, end to end | Chunked upload, a job runner with saved stages, and an end-to-end test on a synthetic match |
| `feat(jobs)` the API | Upload with resume, clip streaming with seeking, downloads and decisions |
| `fix(render)` 48 kHz audio | Clips shipped 96 kHz audio from the loudness filter; both renderers now resample |
| `feat(studio)` upload and review | `/studio/new` and `/studio/jobs/{id}`: progress, clips by platform, approve, copy, download |

## What works now

Uploading a match and getting clips works with no keys. With `OPENAI_API_KEY` set, the job also transcribes the commentary and the model writes the copy.

The hackathon case study is different. The event's ScorePlay platform was wiped afterwards and the team's Twelve Labs allowance is spent, so that run plays from the committed analysis, and nothing on the page claims a write that did not happen. Works with no keys:

- The run's 14 stages, the 76 moments with their evidence, and the timeline.
- The 93 dropped candidates with their reasons, and the storage panel.
- The 18 planned clips, the club check, and an EDL download for every clip and the recap.
- Search, from the recorded Twelve Labs results and then the run's own moments.
- Approve, Reject and "Make a clip anyway", held on the page until reload.

Needs the platforms: video playback, the club's own videos and the uploads in the library, writing tags and logs to ScorePlay, live Twelve Labs search, and the live view at `/studio/130852725/live`.

## What the hackathon run produced

`scripts/studio/analyze.ts` read the 1 hour 45 minute match in 14 stages, in 13 minutes 34 seconds. The result is committed as `src/lib/studio/data/mnu-tot.json`, so the studio opens without waiting on any API.

- 76 moments, from the crowd's noise, the commentary and Twelve Labs. Twelve Labs saw 48 of them on camera.
- 93 candidates weighed and dropped, each with a reason a producer can argue with.
- 18 clips planned for four audiences: match fans, season ticket holders, a sponsor and international fans. 16 are rendered and uploaded into ScorePlay next to the match.
- 30 timecoded logs and 8 tags written onto the match in ScorePlay, read back to confirm they landed.
- 9 of its top 10 moments overlap clips Tottenham's editors made by hand. Same-length picks at random average 1.7, and picking the loudest crowd moments gets 2.5. Counting only single-moment club clips with at least 3 seconds of overlap, it is 4 of 10.

## Where ScorePlay and Twelve Labs come in

| Platform | What Rundown uses it for | Code |
| --- | --- | --- |
| ScorePlay | Reads the match and the club's own clips made from it | `src/lib/studio/library.ts` |
| ScorePlay | Uploads each rendered clip into the match's collection | `scripts/studio/upload.ts` |
| ScorePlay | Writes every top moment back as a timecoded log on the match | `scripts/studio/writeback.ts` |
| ScorePlay | Records a producer's approve or reject as a tag on the clip | `src/lib/studio/review.ts` |
| Twelve Labs | Marengo confirms moments on camera and finds them in plain words | `scripts/studio/visual.ts`, `src/lib/studio/search.ts` |
| Twelve Labs | Pegasus describes each moment for the clip plan | `scripts/studio/descriptions.ts` |
| Twelve Labs | MatchWatch segmentation and editorial review | `scripts/studio/matchwatch.ts` |

The `/api/rundown` engine in `src/lib/rundown` is an earlier, separate pipeline for any match on the platform. [docs/engine.md](docs/engine.md) describes it.

## What the producer gets

A producer on match day has hundreds of assets and time to cut maybe five of them. The brief puts it as "the right five options in front of a producer in the time it used to take to find one." Rundown aims at that:

- **Proposals.** Each one names the moment, the source asset and timecode, the audience (season ticket holder, sponsor, first-time viewer abroad), the format and length, and why it should exist now.
- **Spiked list.** Everything Rundown looked at and passed on, with the reason. A producer's first question is what the system skipped.
- **Approve or spike.** Nothing publishes without a person. Approved pieces get written back to ScorePlay as tags and timecoded actions on the source asset.

Proposals can start from three signals: the footage itself (the bench reacting, the away end, the moment the stadium goes quiet), fan reaction on social, or the archive.

## How it works

```mermaid
flowchart LR
  SP[(ScorePlay<br/>assets + tags)] -->|media search by player, match| R[Rundown]
  R -->|Marengo search<br/>Pegasus analyze| TL[Twelve Labs]
  TL -->|moments + timecodes| R
  R --> Q[Producer queue]
  Q -->|approve / spike + reason| R
  R -->|tags, details, timecoded actions| SP
```

ScorePlay is the system of record. If a decision is not written onto the asset there, the club does not know it happened. Every Twelve Labs asset carries its ScorePlay asset ID in its custom ID field, which is how results find their way back.

## MatchWatch

Built with [MatchWatch](https://github.com/Jazzbai/matchwatch/tree/hacketong). The studio ports the soccer event prompts from `HtownKickoff-main/src/components/stream/HighlightStudio.tsx` and the Jev review prompt, schema, and 50/30/20 score renormalization from `HtownKickoff-main/src/lib/jev.ts`. `HtownKickoff-main/src/lib/highlight-plan.ts` and `HtownKickoff-main/HIGHLIGHTS.md` explain their selection workflow. Rundown keeps its ranking unchanged and stores Jev estimates alongside its scores.

## Run it

You need [bun](https://bun.sh) 1.3 and Node 22 or later. No keys are needed.

```sh
bun install
bun dev
```

Open http://localhost:3000/studio and press **Upload a match**. The bundled ffmpeg cuts the clips, so nothing else needs installing. Jobs and their clips are kept in `.rundown/jobs/` until you delete them.

Copy `.env.example` to `.env.local` to set keys. `OPENAI_API_KEY` turns on transcripts and model-written copy. The ScorePlay and Twelve Labs keys only help against a platform and index someone still has.

For the hackathon case study, press **Present the demo** on the Tottenham match for the seven-step walkthrough the team gave the judges ([docs/demo-script.md](docs/demo-script.md)). `bun scripts/studio/validate.ts` checks its committed run file.

| Variable | Where it comes from |
| --- | --- |
| `SCOREPLAY_API_KEY` | Created by your team on its ScorePlay platform |
| `SCOREPLAY_API_URL` | `https://media.scoreplay.io/v1` |
| `TWELVELABS_API_KEY` | Your team's Twelve Labs org. Give it an expiry of a few months, not never. |
| `TWELVELABS_INDEX_ID` | The pre-built base index shared at onboarding |
| `OPENAI_API_KEY` | Your own OpenAI key, for transcripts and copy. See [docs/jobs.md](docs/jobs.md) for the model settings. |

[docs/deploy.md](docs/deploy.md) covers running it on Fly.io.

## Content rules

Upload only video you have the rights to. A job keeps its video and clips in its own folder until you delete it and posts nothing. With an OpenAI key it sends the audio, and one small frame a second of each cropped moment, to OpenAI; without one it sends nothing.

The hackathon's match footage, photos and logos belong to the clubs and leagues. At the event, teams could process the media but not keep, post or re-host it, and the platforms were wiped afterwards. This repo holds no media, only IDs, timecodes, text and metadata. The EDLs are timecodes and the master's file name, which an editor relinks to their own copy.

## Working in this repo

Run `bun run lint && bun run typecheck && bun run test && bun run build`, then push to `main` once all four pass. CI runs the same checks with no API keys. [AGENTS.md](AGENTS.md) holds the conventions for anyone, or any agent, working here.
