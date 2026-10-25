import type { Metadata } from "next";
import { Highlight, Page, PageIntro } from "@/components/landing/page-parts";
import { ProposalAnatomy, Signals } from "@/components/landing/proposal-anatomy";

export const metadata: Metadata = { title: "Proposals · Rundown" };

export default function Proposals() {
  return (
    <Page>
      <PageIntro eyebrow="Proposals" title="Every proposal makes its case.">
        A producer on match day has hundreds of assets and time to cut maybe five.{" "}
        <Highlight>Each proposal answers the questions they would ask first.</Highlight> Point at a part to find it on
        the card.
      </PageIntro>
      <ProposalAnatomy />
      <h2 className="reveal mt-24 text-tile font-semibold md:mt-32">Four places a proposal can start.</h2>
      <Signals />
    </Page>
  );
}
