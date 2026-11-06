import Link from "next/link";
import { container, Highlight } from "@/components/landing/page-parts";
import { TrySample } from "@/components/studio/jobs/try-sample";
import { cutRange } from "@/lib/jobs/planner";
import { SPORT } from "@/lib/jobs/sports";
import { JOB_PLACEMENTS, PLACEMENT_LABEL, SPORTS } from "@/lib/jobs/types";
import { PLACEMENTS } from "@/lib/rundown/platforms";

const STEPS = [
  { title: "Listen to the crowd", body: "Every second of audio is measured. A roar over the minute before it marks a moment, placed where the play started, not where the noise peaked." },
  { title: "Hear the commentary", body: "With an OpenAI key, the commentary is transcribed with word timings. A call like “what a goal” or “wicket” is a second signal, in the sport's own words." },
  { title: "Cut for each feed", body: "Each platform gets its own shape, length, captions and hashtag limit. A cut runs until the crowd settles, so a long celebration is not chopped." },
  { title: "Follow the play", body: "Vertical and square crops follow where the play is, marked by a vision model once a second and carried between marks by the camera's own pan." },
  { title: "You approve", body: "Every clip lands in front of you with why it was cut that way, and every moment a platform passed on is listed with a reason." },
];

const FEATURES = [
  { title: "Captions burned in", body: "The hook on screen for the first seconds and the commentary word by word, inside each platform's safe zone." },
  { title: "Loudness levelled", body: "Every clip is levelled to -14 LUFS at 48 kHz, the level the feeds normalise to." },
  { title: "Adjust any cut", body: "Move a clip's start or end and only that clip renders again." },
  { title: "Add platforms later", body: "Cut the same match for a feed you skipped, from the moments already found. No new upload." },
  { title: "One zip out", body: "Approved clips, their SRT captions, ready-to-paste posts and a manifest a scheduling tool can read." },
  { title: "No keys needed", body: "The crowd alone finds the moments and rules write the copy. A key adds the commentary, the crop and the model's copy." },
];

// The product: any full match in, clips for every feed out. The hackathon run that started it is at /case-study.
export default function Home() {
  return (
    <>
      <section aria-labelledby="hero-title" className={`${container} pb-20 pt-12 md:pb-28 md:pt-20`}>
        <p className="text-eyebrow font-semibold text-secondary">Rundown</p>
        <h1 id="hero-title" className="mt-3 text-hero font-semibold">
          <span className="block">One full match in.</span>
          <span className="block text-secondary">Clips for every feed out.</span>
        </h1>
        <p className="mt-6 max-w-[34em] text-[17px] text-secondary text-pretty md:text-intro">
          Upload a game from any sport. Rundown finds the moments from the crowd and the commentary, cuts each one
          for TikTok, Reels, Shorts, X and YouTube, captions it and follows the play.{" "}
          <Highlight>You approve every clip before it goes anywhere.</Highlight>
        </p>
        <div className="mt-8 flex flex-wrap items-start gap-3">
          <Link href="/studio/new" className="press inline-flex h-10 items-center rounded-full bg-button px-5 text-footnote font-semibold text-white hover:bg-button-hover">
            Upload a match
          </Link>
          <TrySample />
        </div>
        <p className="mt-3 text-caption text-secondary">No video to hand? The sample makes a three-minute synthetic match on the server and runs the whole pipeline on it.</p>
      </section>

      <section aria-labelledby="sports" className={`${container} pb-20 md:pb-28`}>
        <h2 id="sports" className="text-title2 font-semibold">
          Thirteen sports, each with its own ear
        </h2>
        <p className="mt-3 max-w-[40em] text-body text-secondary">
          Each sport has its own commentary calls and its own pace: tennis points eight seconds apart stay separate
          clips, and a long baseball celebration stays one.
        </p>
        <ul className="mt-6 flex flex-wrap gap-2">
          {SPORTS.map((s) => (
            <li key={s} className="rounded-full bg-fill px-4 py-2 text-footnote font-semibold">
              {SPORT[s].label}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="steps" className={`${container} pb-20 md:pb-28`}>
        <h2 id="steps" className="text-title2 font-semibold">
          How a match becomes clips
        </h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-[14px] bg-grouped p-5">
              <span className="num text-caption font-semibold text-secondary">{i + 1}</span>
              <h3 className="mt-2 text-body font-semibold">{s.title}</h3>
              <p className="mt-2 text-footnote text-secondary">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="feeds" className={`${container} pb-20 md:pb-28`}>
        <h2 id="feeds" className="text-title2 font-semibold">
          A different cut for every feed
        </h2>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-footnote">
            <thead className="text-secondary">
              <tr className="border-b border-separator">
                <th scope="col" className="py-2 pr-4 font-semibold">Feed</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Shape</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Length</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Clips</th>
                <th scope="col" className="py-2 font-semibold">Hashtags</th>
              </tr>
            </thead>
            <tbody>
              {JOB_PLACEMENTS.map((p) => {
                const range = cutRange(p);
                return (
                  <tr key={p} className="border-b border-separator">
                    <th scope="row" className="py-3 pr-4 font-semibold">{PLACEMENT_LABEL[p]}</th>
                    <td className="num py-3 pr-4">{PLACEMENTS[p].aspect}</td>
                    <td className="num py-3 pr-4">{range ? `${range.min} to ${range.max} s` : "the top 8 moments in one cut"}</td>
                    <td className="num py-3 pr-4">{range ? `top ${range.count}` : "1"}</td>
                    <td className="num py-3">{PLACEMENTS[p].hashtagLimit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="features" className={`${container} pb-24 md:pb-32`}>
        <h2 id="features" className="text-title2 font-semibold">
          Built for the person posting
        </h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="rounded-[14px] bg-grouped p-5">
              <h3 className="text-body font-semibold">{f.title}</h3>
              <p className="mt-2 text-footnote text-secondary">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
