# The Rundown engine

The engine takes one match on ScorePlay and returns a ranked list of proposed pieces plus everything it passed on, with a reason for each. It runs on the server in `src/lib/rundown/` and the workspace reaches it through `/api/rundown/*`. The workspace UI is a separate branch and only reads the types in `src/lib/rundown/types.ts`.

## What a run does

Each stage saves the run, so the workspace can poll `GET /api/rundown/runs/{id}` and show progress.

| Stage | API | What happens |
| --- | --- | --- |
| `pull` | ScorePlay `POST /event/search`, `POST /media/search` | Loads the event, its media, the roster and the sponsors. Guesses each video's role (broadcast, ISO, press, published edit) from its name, tags and length. |
| `map` | Twelve Labs `GET /indexes/{id}/indexed-assets` | Finds the indexed copy of each ScorePlay video by the ScorePlay ID in its user metadata, falling back to the filename. Cached in `.rundown/cache/index` until the index changes size. |
| `probe` | Marengo `POST /search` | Runs about 16 searches per sport from `probes.ts`. They cover goals and dunks, and also the moments a broadcast cuts away from: the bench, the away end, the second the stadium goes quiet. |
| `match-log` | none | Lines up the ESPN key events (from `src/lib/match.ts` on the workspace branch) with the broadcast by matching logged goals to Marengo goal hits, one shift per half. See `align.ts`. |
| `fans` | Marengo `POST /search` | Turns each pasted fan post into a search, so a moment people are talking about gets weight even when no probe found it. |
| `press` | Pegasus `POST /analyze` | Picks up to five quotable answers from each press conference, with timecodes. |
| `merge` | none | Joins hits on the same video that touch or overlap into moments, capped at 45 seconds. Two independent hits on one moment outrank one strong hit. |
| `analyze` | Pegasus `POST /analyze` | Watches a padded window around each of the top moments and returns a description, the kind of moment, whether it is a replay, the sponsors in frame, brand safety, a hook, tighter in and out points, and one caption per audience. Cached per window. |
| `angles` | Marengo `POST /search` | Searches the other cameras with Pegasus's description to find a second angle. A separate moment that turns out to be that angle is folded in and spiked as a duplicate. |
| `archive` | ScorePlay and Marengo | Optional. Finds older clips of the same kind for then-and-now pieces. |
| `propose` | none | Ranks pitches and writes the spiked list. Deterministic, see below. |

Marengo 3.0 returns a rank, not a score, so a hit's strength is the probe's weight times 0.93 for every rank below first.

## How proposals are ranked

`propose.ts` maps each kind of moment to the pieces it suits, each for one audience on one platform. A goal becomes a 12-second X clip, a 12-second TikTok, a 15-second Instagram reel of the crowd reaction for season ticket holders and a 40-second YouTube explainer for first-time viewers abroad. A red card becomes an explainer with the rule captioned. A sponsor shot becomes a partner piece only if Pegasus read the logo of one of the club's partners, as listed on ScorePlay.

Score is `0.5 × moment + 0.2 × signal + 0.3 × fit`, multiplied by 0.65 when the club already published the moment. `moment` blends the search strength with Pegasus's intensity. `signal` counts what came from outside the footage (fans, match log, archive). The run keeps the top 15, at most four per moment and four per audience, so the shortlist does not fill up with cuts of one goal. The first five are the shortlist.

Every proposal has a `readyAt` and a `freshForMinutes` from `platforms.ts`. A goal clip on X is worth posting for 10 minutes, a TikTok for 90, an Instagram reel for three hours. YouTube and partner pieces do not go stale.

A moment is spiked, with a sentence a producer can argue with, when it is:

- a broadcast replay of a moment already in the pool,
- flagged by Pegasus as not brand-safe, with its note,
- footage Pegasus rated poor,
- a sponsor shot where the logo Pegasus read is not one of the club's partners,
- weak, meaning one search found it at a low score and nothing else points at it,
- a duplicate of a stronger moment seen from another camera,
- already published by the club (the ranking handles it, but nothing sets `publishedIn` yet; comparing Marengo embeddings against the published edits is the plan), or
- cut for time, with its best score next to the last score kept.

Every source video also gets a storage verdict. A video that none of the searches found anything in is marked for cold storage with that reason, which is the brief's point that a skip is also a storage decision.

## From approval to a post

Approving a proposal starts its social package straight away (`social.ts`):

1. The caption is fitted to the platform: X counts links as 23 characters and gets two hashtags, Instagram and TikTok get five, and YouTube also gets a title of up to 100 characters. Partner pieces add "Presented by" and the partner's name. The club hashtags default to `#COYS #THFC` or `#PorVida #GoSpursGo` and can be set with `RUNDOWN_HASHTAGS`.
2. The package runs its checks: length against the platform's limit, caption length, hashtag count, Pegasus's brand-safety call, a title where the platform needs one, and a readable partner logo for partner pieces.
3. ffmpeg cuts the clip (`render.ts`). It reads each segment of the cut from a presigned ScorePlay MP4 by URL and crops it to the platform's shape around `focusX`, the point across the frame where Pegasus said the action is. It joins the segments, burns in the hook below the platform's own top bar for the first 2.8 seconds, and normalises loudness to -14 LUFS. The working file lives in `.media/` and is deleted when the job ends.
4. The MP4 is uploaded into the match's event on ScorePlay with `rundown-render` and `rundown-platform-<platform>` tags, and its ScorePlay media ID goes on the package.
5. Handoff tags the clip `rundown-ready-to-post` once every check passes. The social team posts it from ScorePlay. At this event that step is a demo, and Rundown never posts anything itself.

Renders run one at a time, so a burst of approvals does not stack ffmpeg jobs on the laptop. Without ffmpeg the package is marked `unavailable` and carries ScorePlay's own preview of the approved range instead, which ScorePlay generates for every video log.

## API

| Route | Does |
| --- | --- |
| `GET /api/rundown/events?q=` | Lists matches on the team's ScorePlay platform. |
| `POST /api/rundown/runs` | Starts a run. Body: `{ eventId, sport, matchLog?, fanPosts?, includeArchive?, analyzeLimit? }`. Returns the run with status `running`. |
| `GET /api/rundown/runs` and `GET /api/rundown/runs/{id}` | List runs, or read one. |
| `POST /api/rundown/runs/{id}/decisions` | `{ proposalId, action: "approve" \| "spike" \| "reopen", reason? }` or `{ spikeId, action: "rescue" }`. Returns the updated run. |
| `POST /api/rundown/runs/{id}/packages` | `{ proposalId, action: "render" \| "handoff" }` or `{ proposalId, action: "caption", caption }` for an approved piece. Returns the updated run; poll it to watch `package.render.status` go from `queued` to `ready`. |
| `POST /api/rundown/runs/{id}/writeback` | `{ what: "moments" \| "spikes" }` writes every moment, or every spike and its reason, onto ScorePlay. |
| `GET /api/rundown/assets/{id}/stream` | A presigned rendition URL from ScorePlay, valid for 24 hours, for the player or, with `?format=mp4`, for downloading a rendered clip by its `package.render.mediaId`. Nothing is proxied or stored. |

Without `SCOREPLAY_API_KEY`, `TWELVELABS_API_KEY` and `TWELVELABS_INDEX_ID`, a run returns the hand-written sample in `demo.ts` straight away, and writes come back with `simulated: true`. The UI can be built against that.

## What gets written to ScorePlay

Approving a piece adds one video log (a timecoded action) per segment of its cut, on that segment's source asset, and tags the asset `rundown-approved` so media search can find it. Spiking a piece, or writing the spiked list, adds a log with the reason in the comment. ScorePlay creates log tags by name, and every tag Rundown writes starts with `rundown-`:

`rundown`, `rundown-approved`, `rundown-spiked`, `rundown-rescued`, `rundown-moment`, `rundown-render`, `rundown-ready-to-post`, `rundown-platform-<platform>`, `rundown-audience-<audience>`, `rundown-format-<aspect>-<kind>`, `rundown-kind-<kind>`, `rundown-spike-<reason>`.

Check these names with ScorePlay staff before the first real write. ScorePlay returns no log IDs when it creates logs, so reopening an approved piece does not remove the earlier log.

## Settings

| Variable | Default | Use |
| --- | --- | --- |
| `TWELVELABS_PEGASUS_MODEL` | `pegasus1.6` | Set to `pegasus1.5` if the org does not have 1.6. |
| `TWELVELABS_SCOREPLAY_ID_KEY` | unset | The user metadata key that holds the ScorePlay ID. Unset, the engine checks every value. |
| `RUNDOWN_DATA_DIR` | `.rundown` | Where runs and cached Pegasus answers are kept. Only IDs, timecodes and text. |
| `FFMPEG_PATH` | `ffmpeg` on the PATH | The ffmpeg that cuts social clips. `brew install ffmpeg` on a Mac. |
| `RUNDOWN_FONT` | Arial Bold on macOS, DejaVu Sans Bold on Linux | The font for the burned-in hook. With no font found, clips render without it. |
| `RUNDOWN_HASHTAGS` | by sport | Comma-separated club hashtags. |

## Not yet checked against the real APIs

CI has no keys, and neither did the machine this was written on. Everything below the clients follows the ScorePlay OpenAPI file and the Twelve Labs v1.3 reference, but these points need a live run:

- which user metadata key holds the ScorePlay ID, and whether the base index puts it on the indexed asset or the asset,
- whether sync `/analyze` accepts a short window of a two-hour match, or always needs the async task the client falls back to,
- whether the API key has `can_do_media_download`, which the stream route needs for presigned URLs,
- the roles guessed from media names, which depend on how the club named its files,
- the upload flow and the render itself: ffmpeg was not installed where this was written, so the filtergraph in `render.ts` has not run yet,
- the platform limits in `platforms.ts`, which come from memory and should be checked against each platform's help pages.
