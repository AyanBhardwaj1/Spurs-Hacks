# Clips from any match

Upload a full match video and Rundown finds its moments, cuts each one for every platform you pick, and puts them in front of you to approve. It grew out of the hackathon run in this repo, which read one Tottenham match from the club's ScorePlay. This engine takes any video file instead and needs no keys.

The code is in `src/lib/jobs/`, the API in `src/app/api/jobs/`, and the pages at `/studio/new` and `/studio/jobs/{id}`.

## What a job does

Each stage saves `job.json`, so the page can follow along and a restart keeps finished work.

| Stage | What happens | Needs |
| --- | --- | --- |
| Upload | The browser sends the video in 8 MiB chunks. A chunk that does not start where the upload left off gets a 409 with the byte to resume from. | Nothing |
| Read the video | ffmpeg reads the duration, the frame size (rotated phone video included), the frame rate and whether there is audio. | ffmpeg |
| Measure the crowd | The audio is cut into 100 ms frames; the crowd floor is the 20th percentile of the frames around each second, which follows the crowd and mostly ignores speech. | Audio |
| Transcribe | OpenAI speech-to-text with word timings, in 10-minute pieces. | `OPENAI_API_KEY` |
| Find the moments | A rise of 6 dB or more over the minute before is a roar, placed at its onset. A commentary call ("what a", "goal", "touchdown", "dunk", ...) is another signal. Both together score highest. Edges snap to a camera cut within 3 s. | Audio or a transcript |
| Plan | Each platform gets its own cut and its own number of moments. Every moment a platform passes on is kept with the reason. With a key, the model rewrites the hook, caption and title. | Nothing, or a key for copy |
| Render | ffmpeg crops to the platform's shape, joins the segments, burns in the hook and the commentary as captions, and levels loudness to -14 LUFS at 48 kHz. | ffmpeg |

With no audio and no transcript, the job samples six evenly spaced moments and says so on each one.

## How each platform is cut

The play comes before the crowd, so every short cut opens on the build-up and lands the roar in the first seconds people watch.

| Platform | Shape | Cut | Moments |
| --- | --- | --- | --- |
| TikTok | 9:16 | 18 s, opening 8 s before the roar | top 5 |
| Instagram Reels | 9:16 | 18 s, opening 9 s before, short enough to loop | top 4 |
| YouTube Shorts | 9:16 | 28 s, with the build-up and the reaction | top 4 |
| X | 16:9 and 1:1 | 15 s, opening 10 s before | top 3 |
| YouTube | 16:9 | one highlights cut of the top 8 moments in match order | 1 |

Captions keep to each platform's caption and hashtag limits from `src/lib/rundown/platforms.ts`, and burned-in text stays out of the bands each app covers with its own buttons. Moments scoring under 0.30 are left out everywhere. The rules are in `src/lib/jobs/planner.ts`; the tests next to it pin them.

## What the model may do

Only write copy. It sees each clip's moment, what was said and the platform's limits. It cannot move a cut, add a clip or change hashtags. Its answer is checked against a schema in code, every field is cut to its platform's limit, and a blank or missing field keeps the rule-written copy. If the call fails, the job uses the rule copy and says why on the Plan stage.

## Settings

| Variable | Default | Use |
| --- | --- | --- |
| `OPENAI_API_KEY` | unset | Turns on the transcript and the model's copy. Without it the job runs on the crowd alone and says so. |
| `OPENAI_MODEL` | `gpt-4.1-mini` | The model that writes copy. |
| `OPENAI_TRANSCRIBE_MODEL` | `whisper-1` | The speech-to-text model. It must return word timings. |
| `RUNDOWN_MAX_UPLOAD_GB` | `12` | The largest video a job takes. |
| `RUNDOWN_DATA_DIR` | `.rundown` | Where jobs live: `jobs/{id}/` holds `job.json`, the video, the transcript and the clips. |
| `RUNDOWN_RUNNER` | on | `off` takes uploads without running them. |
| `FFMPEG_PATH` | ffmpeg-static | The ffmpeg to use. The repo ships one through `ffmpeg-static`. |
| `RUNDOWN_FONT` | Arial Bold on macOS, DejaVu Sans Bold on Linux | The font for burned-in text. |

## Limits

- Jobs run one at a time on one server, and the lock that keeps their writes in order lives in that process. A second machine would need a shared queue and storage.
- The crop is centred. The hackathon run found the action with Pegasus; this engine has no video model, so a play near the touchline can fall outside a 9:16 crop.
- The commentary calls are an English word list. Other languages still get crowd moments and transcripts, but not call matching.
- Nothing is posted anywhere. A producer downloads an approved clip and posts it.

## Footage

Upload only video you have the rights to: your own recordings, or a club's footage you are allowed to process. The video stays in its job's folder until you delete the job, and nothing is sent anywhere except the audio to OpenAI when a key is set.
