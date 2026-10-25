import type { Moment, MomentKind } from "../../src/lib/studio/types";

export const TAXONOMY = {
  source: "Rundown",
  kinds: {
    goal: "Goal", "disallowed-goal": "Disallowed goal", chance: "Chance", save: "Save",
    card: "Card", skill: "Skill", tackle: "Tackle", celebration: "Celebration",
    kickoff: "Kickoff", "full-time": "Full time", other: "Other",
  } satisfies Record<MomentKind, string>,
  redCard: "Red card",
  yellowCard: "Yellow card",
};

export function tagsFor(moment: Pick<Moment, "kind" | "title" | "summary">): string[] {
  const text = `${moment.title} ${moment.summary}`;
  const label = moment.kind === "card" && /red card|sent off|straight red/i.test(text)
    ? TAXONOMY.redCard
    : moment.kind === "card" && /yellow|booked|booking/i.test(text) ? TAXONOMY.yellowCard : TAXONOMY.kinds[moment.kind];
  return [TAXONOMY.source, label];
}
