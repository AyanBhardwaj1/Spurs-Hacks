import type { Metadata } from "next";
import { Highlight, Page, PageIntro } from "@/components/landing/page-parts";
import { Pipeline } from "@/components/landing/pipeline";
import { Writeback } from "@/components/landing/writeback";

export const metadata: Metadata = { title: "How it works · Rundown" };

export default function HowItWorks() {
  return (
    <Page>
      <PageIntro eyebrow="How it works" title="One match in. Five drafts out.">
        Rundown reads the club&apos;s library on <Highlight>ScorePlay</Highlight>, watches the footage with{" "}
        <Highlight>Twelve Labs</Highlight> and puts a short list in front of a producer.{" "}
        <Highlight>Every decision goes back onto the asset,</Highlight> so the club can search it later.
      </PageIntro>
      <Pipeline />
      <Writeback />
    </Page>
  );
}
