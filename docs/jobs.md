# Clips from any match

Upload a full match video and Rundown finds its moments, cuts each one for every platform you pick, and puts them in front of you to approve. It grew out of the hackathon run in this repo, which read one Tottenham match from the club's ScorePlay. This engine takes any video file instead and needs no keys.

The code is in `src/lib/jobs/`, the API in `src/app/api/jobs/`, and the pages at `/studio/new` and `/studio/jobs/{id}`.

## What a job does

Each stage saves `job.json`, so the page can follow along and a restart keeps finished work.

| Stage | What happens | Needs |
| --- | --- | --- |
| Upload | The browser sends the video in 8 MiB chunks. A chunk that does not start where the upload left off gets a 409 with the byte to resume from. | Nothing |
| Read the video | ffmpeg reads the duration, the frame size (rotated phone video included), the frame rate and whether there is audio. A file written as a stream, such as a browser or phone WebM, has no length in its header, so it is measured with a copy pass that reads every packet without decoding. Variable frame rate video is fine: every clip renders at a constant 30 fps. | ffmpeg |
| Measure the crowd | The audio is cut into 100 ms frames; the crowd floor is the 20th percentile of the frames around each second, which follows the crowd and mostly ignores speech. | Audio |
| Transcribe | OpenAI speech-to-text with word timings, in 10-minute pieces. | `OPENAI_API_KEY` |
| Find the moments | A rise of 6 dB or more over the minute before is a roar, placed at its onset. A commentary call is another signal: shared calls ("what a", "unbelievable") plus the sport's own ("wicket", "ace", "knockout", ...). Both together score highest. Roars closer than the sport's gap between plays are one moment. Edges snap to a camera cut within 3 s. | Audio or a transcript |
| Plan | Each platform gets its own cut and its own number of moments. Every moment a platform passes on is kept with the reason. With a key, the model rewrites the hook, caption and title. | Nothing, or a key for copy |
| Follow the play | For each moment that a vertical or square clip uses, the vision model marks where the play is once a second, and the measured camera pan carries the crop between marks. A cut lets the crop jump, and a pan-speed limit stops it jittering. The pan and cut rules are the hackathon's, shared in `focus.ts`. | `OPENAI_API_KEY`; otherwise the crop is centred |
| Render | ffmpeg crops to the platform's shape, joins the segments, burns in the hook and the commentary as captions (three words at a time, the word being said in yellow), and levels loudness to -14 LUFS at 48 kHz. Then it makes the clip's cover: the frame where the play happens, cropped the same way, with the hook across the middle in large type. | ffmpeg |

With no audio and no transcript, the job samples six evenly spaced moments and says so on each one.

### Sports

A job names its sport, and `sports.ts` holds what changes with it: the commentary calls, the gap between two separate plays, and the hashtags. Thirteen are listed: soccer, basketball, American football, ice hockey, baseball, tennis, cricket, rugby, volleyball, boxing or MMA, motorsport, esports, and "another sport", which listens for every sport's calls. Fast sports get a short gap (8 s for tennis and volleyball, 10 s for basketball and esports), so back-to-back points stay separate clips; slow ones keep 20 to 25 s, so a long celebration stays one moment. Calls are matched in Spanish, Portuguese, French, German and Italian too ("golazo", "increíble", "incroyable", "was für ein Tor", "che gol"), since the transcript keeps the commentary's own language.

## How each platform is cut

The play comes before the crowd, so every short cut opens on the build-up and lands the roar in the first seconds people watch. Each runs on until a second after the crowd settles, so a long celebration is not cut off and a short roar does not drag; the length stays inside the range below.

| Platform | Shape | Cut | Moments |
| --- | --- | --- | --- |
| TikTok | 9:16 | opens 8 s before the roar, 14 to 26 s | top 5 |
| Instagram Reels | 9:16 | opens 9 s before, 15 to 21 s, short enough to loop | top 4 |
| YouTube Shorts | 9:16 | 22 to 44 s, with the build-up and the reaction | top 4 |
| X | 16:9 and 1:1 | opens 10 s before, 14 to 20 s | top 3 |
| Vertical recap | 9:16 | the top 6 moments in match order, 6 to 8 s each, for any vertical feed | 1 |
| YouTube | 16:9 | one highlights cut of the top 8 moments in match order | 1 |

Pick a post language and the model writes every hook, caption and title in it, whatever language the commentary is in: English, Spanish, Portuguese, French, German, Italian, Arabic, Japanese, Korean, Hindi, Indonesian or Turkish. It needs `OPENAI_API_KEY`; without one the copy is in English and the plan stage says so.

Under "Your brand", pick the colour the caption word being said turns, and add a logo (PNG or JPEG, up to 2 MB). The logo sits in the top corner of every clip and cover, under the band each app covers, at 14% of the short side and slightly see-through. `PUT /api/jobs/{id}/logo` with the image as the body does the same; clips rendered afterwards carry it.

Tick "End each short clip with a slow-motion replay" on upload and every short clip ends with the three seconds around its play again at half speed, sound slowed with it and labelled Replay, which adds 6 s to the lengths above. The replay sits inside the cut, so trimming a clip moves its replay with it; the YouTube highlights cut never has one.

Captions keep to each platform's caption and hashtag limits from `src/lib/rundown/platforms.ts`, and burned-in text stays out of the bands each app covers with its own buttons. Moments scoring under 0.30 are left out everywhere. The YouTube highlights cut's description lists a chapter for each moment, so viewers can jump between them; YouTube shows chapters only with three or more, each at least 10 s long, so a shorter cut has none. The rules are in `src/lib/jobs/planner.ts`; the tests next to it pin them.

## After a job finishes

Above the clips, a timeline draws the crowd's loudness across the whole match with every moment marked; filled marks became clips. Click a second the rules missed (or move along it with the arrow keys and press Enter) and Rundown makes it a moment, with a clip for every short platform, rendered with the copy and the crop like the rest. `POST /api/jobs/{id}/moments` with `{ "at": seconds }` does the same.

Review from the keyboard: J and K move between clips in the order the page shows them, A approves and moves on, R rejects and moves on, U undoes. Each finished stage shows how long it took.

Each platform's clips are shown in posting order, and the card says why: a clip's strength is half its moment's score, plus points for evidence the job has about the clip (the crowd and the commentary agreed, the commentary called it, the cut ends as the crowd settles, the crop follows the play or nothing is cropped, the clip is short enough to watch twice). It is a rule you can check, not a prediction of views. The rule is in `src/lib/jobs/rank.ts`, and the manifest in the zip carries each clip's place in the order.

- **Change the hook.** Each clip offers other hooks (the commentary's words, a line that suits any moment such as "Wait for it…", the match and the time), or type your own of up to 60 characters. The clip and its cover render again with it, and its approval is cleared. `POST /api/jobs/{id}/clips/{clipId}/hook` with `{ hook }`.
- **Adjust a cut.** On any single-moment clip, move the start and end a second at a time and render it again. The new edges must stay inside the video, run at least 3 s and keep to the platform's length limit. The clip's approval is cleared, since it was given for the old cut. `POST /api/jobs/{id}/clips/{clipId}/trim` with `{ start, end }`.
- **Add platforms.** "Also cut it for" plans the missing platforms from the moments the job already found and renders only those clips, with the model's copy and play-following when a key is set. `POST /api/jobs/{id}/placements` with `{ placements }`.

Both run as render-only tasks in the same one-at-a-time queue.

- **Download.** "Download approved" gives one zip of every approved clip with its SRT captions (when there is a transcript), `posts.txt` with each post ready to paste, and `manifest.json` listing each clip's file, platform, length, copy and source range for a scheduling tool. "Download every clip" takes all rendered clips. Each clip also has its own SRT link. `GET /api/jobs/{id}/export[?all=1]` and `GET /api/jobs/{id}/clips/{clipId}/srt`.

## What the model may do

Write copy, and mark where the play is on sampled frames. It sees each clip's moment, what was said and the platform's limits. It cannot move a cut, add a clip or change hashtags. Its answer is checked against a schema in code, every field is cut to its platform's limit, and a blank or missing field keeps the rule-written copy. If the call fails, the job uses the rule copy and says why on the Plan stage. Its frame marks are checked the same way: a frame it skips, repeats or numbers out of range gets no mark, the camera's pan fills the gap, and a moment whose call fails keeps a centred crop.

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
- Without an OpenAI key the crop is centred, so a play near the touchline can fall outside a 9:16 crop. With a key it follows the play from one mark a second, which can lag a very fast switch of play.
- The commentary calls are an English word list. Other languages still get crowd moments and transcripts, but not call matching.
- Nothing is posted anywhere. A producer downloads an approved clip and posts it.

## Footage

Upload only video you have the rights to: your own recordings, or a club's footage you are allowed to process. The video stays in its job's folder until you delete the job, and nothing is sent anywhere except, when a key is set, the audio and one small frame a second of each cropped moment to OpenAI.
