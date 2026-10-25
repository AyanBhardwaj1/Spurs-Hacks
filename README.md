# Rundown (Name WIP)

Rundown takes every asset from one game and drafts the content a club should make from it. A producer gets a short list of proposed pieces, each aimed at an audience, and approves or spikes them. Rundown also lists what it considered and dropped, with a reason, so a person can rescue the clip the model got wrong.

Built in two days at the Spurs² Hackathon (UT Austin, October 22 to 23, 2026) for Problem 1 of the [builder brief](https://scoreplay.notion.site/Spurs-Hackathon-Builder-Brief-3fb9d8f0d4ce815096d4dc8294142346), Assisted Auto-Production. It runs on the [ScorePlay](https://developer.scoreplay.io/) and [Twelve Labs](https://docs.twelvelabs.io/) APIs with match content from Tottenham Hotspur and the San Antonio Spurs.

Status: the repo, CI and landing page are set up. The producer tool is not built yet, so the next section describes the target.

## Studio

Built with [MatchWatch](https://github.com/Jazzbai/matchwatch/tree/hacketong). The studio ports the soccer event prompts from `HtownKickoff-main/src/components/stream/HighlightStudio.tsx` and the Jev review prompt, schema, and 50/30/20 score renormalization from `HtownKickoff-main/src/lib/jev.ts`. `HtownKickoff-main/src/lib/highlight-plan.ts` and `HtownKickoff-main/HIGHLIGHTS.md` explain their selection workflow. Rundown keeps its ranking unchanged and stores Jev estimates alongside its scores.

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

## Run it

You need [bun](https://bun.sh) 1.3 and Node 22 or later. Next.js still runs on Node; bun installs packages and runs scripts.

```sh
bun install
cp .env.example .env.local   # then fill in your team's keys
bun dev
```

Open http://localhost:3000. The landing page is `/`.

| Variable | Where it comes from |
| --- | --- |
| `SCOREPLAY_API_KEY` | Created by your team on its ScorePlay platform |
| `SCOREPLAY_API_URL` | `https://media.scoreplay.io/v1` |
| `TWELVELABS_API_KEY` | Your team's Twelve Labs org. Give it an expiry of a few months, not never. |
| `TWELVELABS_INDEX_ID` | The pre-built base index shared at onboarding |

To put the app online, follow [docs/deploy.md](docs/deploy.md).

## Content rules

The match footage, photos and logos belong to the clubs and leagues. For this event:

- The organizers expect teams to process the media. Rundown may download, clip, transform and render it, locally or in the cloud, but it does not keep it. Working copies are deleted when the job finishes, nothing is committed or re-hosted, and derived clips go back into ScorePlay.
- Nothing posts outside the event. Social publishing is demo only.
- Platforms are wiped after the event.
- Only registered teammates use the team's credentials.

## Working in this repo

Branch, open a PR, squash-merge once CI passes. [CONTRIBUTING.md](CONTRIBUTING.md) covers the one-time Coordigent setup and lists the checks. [AGENTS.md](AGENTS.md) holds the conventions and says which skill in `.claude/skills` to use for each task.
