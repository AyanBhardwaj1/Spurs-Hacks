import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Live } from "./live";

// The ScorePlay video log Rundown writes when a producer approves the equaliser proposal. Keys and tag
// names follow writeApproval in src/lib/rundown/writeback.ts on the engine branch; the values are examples.
const tags = ["rundown", "rundown-approved", "rundown-audience-season-ticket", "rundown-format-9x16-reaction"];

const Key = ({ children }: { children: string }) => <span className="code-key">&quot;{children}&quot;</span>;
const Str = ({ children }: { children: string }) => <span className="code-string">&quot;{children}&quot;</span>;
const Num = ({ children }: { children: string }) => <span className="code-number">{children}</span>;
const P = ({ children }: { children: ReactNode }) => <span className="code-punct">{children}</span>;

const lines: ReactNode[] = [
  <P key="open">{"{"}</P>,
  <Fragment key="media">
    {"  "}
    <Key>media_id</Key>
    <P>: </P>
    <Num>48213</Num>
    <P>,</P>
  </Fragment>,
  <Fragment key="start">
    {"  "}
    <Key>start_offset</Key>
    <P>: </P>
    <Num>1062</Num>
    <P>,</P>
  </Fragment>,
  <Fragment key="end">
    {"  "}
    <Key>end_offset</Key>
    <P>: </P>
    <Num>1076</Num>
    <P>,</P>
  </Fragment>,
  <Fragment key="comment">
    {"  "}
    <Key>comment</Key>
    <P>: </P>
    <Str>Rundown approved: Equaliser, home end reaction. 9:16, 14s.</Str>
    <P>,</P>
  </Fragment>,
  <Fragment key="tags-open">
    {"  "}
    <Key>raw_tags</Key>
    <P>: [</P>
  </Fragment>,
  ...tags.map((tag, i) => (
    <Fragment key={tag}>
      {"    "}
      <Str>{tag}</Str>
      {i < tags.length - 1 ? <P>,</P> : null}
    </Fragment>
  )),
  <Fragment key="tags-close">
    {"  "}
    <P>]</P>
  </Fragment>,
  <P key="close">{"}"}</P>,
];

const meanings = [
  { tag: "rundown-approved", detail: "A producer approved a piece cut from this stretch." },
  { tag: "rundown-spiked", detail: "Rundown or a producer passed on it. The comment says why." },
  { tag: "rundown-moment", detail: "A moment Twelve Labs found, kept searchable even if nobody cut it." },
];

export function Writeback() {
  return (
    <div className="mt-20 grid gap-10 md:mt-28 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-14">
      <div className="reveal">
        <h2 className="text-tile font-semibold">Every decision lands on the asset.</h2>
        <p className="mt-4 max-w-[40ch] text-secondary">
          ScorePlay is the club&apos;s system of record. If a decision is not on the asset, the club does not know it
          happened. Every tag starts with <span className="timecode text-label">rundown</span>, so the team can find
          or remove what Rundown wrote in one search.
        </p>
        <dl className="mt-8 grid gap-4">
          {meanings.map((item) => (
            <div key={item.tag} className="grid gap-1 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
              <dt className="timecode text-footnote font-semibold">{item.tag}</dt>
              <dd className="text-subhead text-secondary">{item.detail}</dd>
            </div>
          ))}
        </dl>
      </div>
      <Live reveal className="theme-dark overflow-hidden rounded-[18px] shadow-[0_30px_70px_-30px_rgb(0_0_0/0.5)]">
        <figure className="bg-card">
          <figcaption className="flex items-center justify-between px-5 pt-4 text-caption">
            <span className="timecode font-semibold">video log · on approval</span>
            <span className="text-secondary">Example values</span>
          </figcaption>
          <pre className="overflow-x-auto px-5 py-4 font-mono text-[12px] leading-[1.7]">
            <code>
              {lines.map((line, i) => (
                <span key={i} className="code-line block" style={{ "--i": i } as CSSProperties}>
                  {line}
                  {i === lines.length - 1 ? (
                    <span aria-hidden className="caret ml-1 inline-block h-[13px] w-[7px] translate-y-[2px] bg-label/70" />
                  ) : null}
                </span>
              ))}
            </code>
          </pre>
        </figure>
      </Live>
    </div>
  );
}
