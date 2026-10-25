import type { Metadata } from "next";
import { Highlight, Page, PageIntro } from "@/components/landing/page-parts";
import { RunningOrder } from "@/components/landing/running-order";

export const metadata: Metadata = { title: "Try the demo · Rundown" };

export default function Demo() {
  return (
    <Page>
      <PageIntro eyebrow="Producer in control" title="Nothing publishes without a person.">
        Rundown drafts. A producer decides.{" "}
        <Highlight>What Rundown passed on stays in view, with the reason,</Highlight> so a wrong call is one click from
        the queue. Try it: approve, spike or rescue any row.
      </PageIntro>
      <div className="mt-12 md:mt-16">
        <RunningOrder />
      </div>
    </Page>
  );
}
