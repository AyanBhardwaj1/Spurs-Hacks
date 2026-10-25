import type { Player } from "../../src/lib/studio/types";
import type { SpPlayerRecord } from "./scoreplay";

// ScorePlay's /players mixes Tottenham's football squad and staff with the San
// Antonio Spurs basketball roster, and has no team field to tell them apart.
// These IDs are the basketball entries, read off the list by hand.
const BASKETBALL_IDS = new Set(Array.from({ length: 25 }, (_, i) => 737042 + i));

// The name a caption uses, where it is not simply the last surname.
const SHORT_NAMES: Record<number, string> = {
  737005: "Bruno Saltor",
  737009: "João Victor",
  737010: "Bentancur",
  737017: "Sávio",
  737018: "Porro",
  737023: "Senesi",
  737031: "Richarlison",
  737034: "Mateus Fernandes",
  737038: "Solanke",
};

const titleCase = (name: string) => name.replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());

export function toPlayer(record: SpPlayerRecord): Player {
  const name = record.full_name === record.full_name.toLowerCase() ? titleCase(record.full_name) : record.full_name;
  const lastName = record.last_name === record.last_name.toLowerCase() ? titleCase(record.last_name) : record.last_name;
  const shortName = SHORT_NAMES[record.ID] ?? lastName.replace(/^van /, "Van ").replace(/^de /, "De ");
  return { id: record.ID, name, shortName, ...(record.profile_picture ? { photoUrl: record.profile_picture } : {}) };
}

/** Tottenham's football players and staff. */
export function footballRoster(records: SpPlayerRecord[]): Player[] {
  return records.filter((r) => !BASKETBALL_IDS.has(r.ID)).map(toPlayer);
}
