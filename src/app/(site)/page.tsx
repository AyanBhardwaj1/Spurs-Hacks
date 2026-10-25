import { HeroFilm } from "@/components/landing/hero-film";
import { MatchFunnel } from "@/components/landing/match-funnel";
import { container, Highlight } from "@/components/landing/page-parts";

export default function Home() {
  return (
    <>
      <section aria-labelledby="hero-title" className={`${container} pb-24 pt-12 md:pb-32 md:pt-20`}>
        <HeroFilm>
          <h1 id="hero-title" className="text-hero font-semibold">
            <span className="block">Every clip watched.</span>
            <span className="block text-secondary">Five worth making.</span>
          </h1>
          <p className="mt-6 max-w-[30em] text-[17px] text-secondary text-pretty md:text-intro">
            Rundown watches everything a club shot at one game and drafts the pieces worth making, each for a
            named audience. <Highlight>A producer approves or spikes every one.</Highlight>
          </p>
        </HeroFilm>
      </section>

      <section aria-labelledby="funnel" className={`${container} pb-24 md:pb-32`}>
        <div className="reveal max-w-[820px]">
          <p className="text-eyebrow font-semibold text-secondary">The brief</p>
          <h2 id="funnel" className="mt-3 text-headline font-semibold text-balance">
            Hundreds of assets in. Five pieces out.
          </h2>
          <p className="mt-6 max-w-[38em] text-intro text-secondary">
            The brief asks for{" "}
            <Highlight>the right five options in front of a producer in the time it used to take to find one.</Highlight>{" "}
            Rundown watches every clip from the match, so the producer starts from five.
          </p>
        </div>
        <MatchFunnel />
      </section>
    </>
  );
}
