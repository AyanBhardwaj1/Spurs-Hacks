# Deploy Rundown

Rundown runs online as one Docker container on [Fly.io](https://fly.io): one machine in Dallas that stays on, with a 1 GB volume for run data. Fly builds the image from the `Dockerfile` on its own servers, so you don't need Docker on your laptop. After the setup below, every merge to `main` deploys.

It runs as one long-lived server, not serverless functions, because of how the engine works ([docs/engine.md](engine.md)). A run keeps going after its request returns, runs live in the server's memory and in `RUNDOWN_DATA_DIR`, and clips are cut with ffmpeg. Serverless hosts stop work when the response ends and give each request a fresh disk.

## Before you start

- Install `flyctl`: `brew install flyctl`.
- Have a Fly account. `fly auth signup` makes one.
- Have your team's ScorePlay and Twelve Labs keys, the same ones in your `.env.local`.

## Set up the app once

1. Sign in.

   ```sh
   fly auth login
   ```

2. Create the app. The name becomes the address, `https://rundown-spurs.fly.dev`.

   ```sh
   fly apps create rundown-spurs
   ```

   If the name is taken, choose another and change `app` in `fly.toml` to match.

3. Create the volume in the same region as the app.

   ```sh
   fly volumes create rundown_data --region dfw --size 1
   ```

4. Add the keys and a site password as secrets. Fly passes them to the server as environment variables and never writes them into the image.

   ```sh
   fly secrets set \
     SITE_PASSWORD=... \
     SCOREPLAY_API_KEY=... \
     SCOREPLAY_API_URL=https://media.scoreplay.io/v1 \
     TWELVELABS_API_KEY=... \
     TWELVELABS_INDEX_ID=...
   ```

   Without `SITE_PASSWORD`, the deployed site answers every page with "Set SITE_PASSWORD to open this site." [Sign in](#sign-in) explains why.

   To change an optional engine setting, such as `TWELVELABS_PEGASUS_MODEL` or `RUNDOWN_HASHTAGS`, set it the same way. `docs/engine.md` lists them. Leave `RUNDOWN_DATA_DIR`, `FFMPEG_PATH` and `RUNDOWN_FONT` unset. The image sets `RUNDOWN_DATA_DIR` to the volume, and the engine finds the image's ffmpeg and font by itself.

5. Deploy from your checkout.

   ```sh
   fly deploy
   ```

6. Open the site.

   ```sh
   fly open
   ```

## Sign in

The site and its API sit behind one shared password, because the API starts runs that spend Twelve Labs credits and approves pieces that write to the club's ScorePlay. The browser shows its own sign-in prompt. Enter any user name and the `SITE_PASSWORD` value. Share it with the team and the judges, not on a public page.

`src/proxy.ts` checks the password before any page or API route runs. On Fly, an unset password closes the site instead of opening it. On your laptop, `bun dev` asks for nothing unless you set `SITE_PASSWORD` in `.env.local`. To change the password, run `fly secrets set SITE_PASSWORD=...` again. Fly restarts the machine with the new value.

## Deploy from GitHub

1. Create a deploy token for the app.

   ```sh
   fly tokens create deploy
   ```

2. On GitHub, open the repository's Settings > Secrets and variables > Actions, and add the token as a secret named `FLY_API_TOKEN`.

From then on, the Deploy workflow (`.github/workflows/deploy.yml`) deploys each push to `main`. To deploy without a push, open Actions > Deploy and click Run workflow. Without the secret, the workflow skips the deploy and says so in the run summary.

A pull request that changes the `Dockerfile`, `fly.toml`, `next.config.ts` or the dependencies also builds the image, without deploying it, so a broken build shows up before it reaches `main`.

## Check a deploy

- `fly status` shows the machine and whether its health check passes. The check loads `/api/health` every 15 seconds, without the password.
- `fly logs` streams the server's output, including engine errors.
- `fly ssh console -C "ls /data/rundown"` lists the saved runs on the volume.

## Keep it to one machine

Run one machine only. Runs live in that machine's memory, so a second machine would not see them, and the volume can attach to one machine at a time. Don't run `fly scale count` above 1.

The volume holds run data: IDs, timecodes and text. The engine cuts clips in `/app/.media`, which is not on the volume, and deletes each working file when its job ends, as the content rules require.

## Run the image somewhere else

The image doesn't depend on Fly. To try it on a machine with Docker:

```sh
docker build -t rundown .
docker run -p 3000:3000 -v rundown-data:/data --env-file .env.local rundown
```

On another host such as Railway or Render, point it at the `Dockerfile`, mount a volume at `/data`, set the same secrets, and keep one instance. Only Fly closes the site when `SITE_PASSWORD` is missing, so on another host set it before you share the address.

## After the event

The event wipes the ScorePlay and Twelve Labs platforms. To remove the app, its volume and its secrets from Fly as well:

```sh
fly apps destroy rundown-spurs
```
