/**
 * Pb TOYOTA Policy Table (G-CATS judgment Ver.5.1.x, Appendix II No.10 ELV (Pb)).
 * Destination columns: EU (Europe, Israel, Turkey), KR, CN, TW, IN, JP, OTH.
 * Entries whose cell carries a flip-date qualifier such as "2026~NG" or that need a separate flow
 * (Application ID 71) are HOLD: the app never guesses which side of the date applies.
 */
export const PB_DESTINATIONS = ["EU", "KR", "CN", "TW", "IN", "JP", "OTH"] as const;
export type PbDestination = (typeof PB_DESTINATIONS)[number];
export const PB_SOURCE = "G-CATS judgment Ver.5.1.10, Appendix II No.10 ELV (Pb), Pb TOYOTA Policy Table";

type Cell = "OK" | "NG" | "HOLD";
const all = (v: Cell): Cell[] => PB_DESTINATIONS.map(() => v);
const std: Cell[] = ["NG", "NG", "OK", "NG", "OK", "OK", "OK"]; // EU KR CN TW IN JP OTH (dated "YYYY~" entries already in the past)

const TABLE: Record<string, { cells: Cell[]; note?: string }> = {
  "69": { cells: all("OK") }, "70": { cells: all("NG") },
  "71": { cells: all("HOLD"), note: "Application ID 71 needs the dedicated Application Code 71 flow." },
  "72": { cells: all("OK") }, "3": { cells: all("OK") }, "52": { cells: all("NG") }, "51": { cells: all("NG") },
  "73": { cells: all("NG") }, "85": { cells: all("OK") },
  "86": { cells: all("HOLD"), note: "Entry 5(b)(ii) carries 2024~ / 2026~NG qualifiers; confirm the effective date in the policy table." },
  "8": { cells: std }, "10": { cells: all("NG") }, "48": { cells: all("NG") }, "11": { cells: all("NG") }, "12": { cells: all("NG") },
  "53": { cells: std }, "54": { cells: std }, "55": { cells: std }, "56": { cells: std }, "57": { cells: all("OK") },
  "67": { cells: std },
  "68": { cells: all("HOLD"), note: "Entry 8(f)(ii) carries a 2026~NG qualifier; confirm the effective date." },
  "75": { cells: all("HOLD"), note: "Entry 8(g)(i) carries 2022 OCT~ / 2026 JAN~NG qualifiers; confirm the effective date." },
  "76": { cells: all("HOLD"), note: "Entry 8(g)(ii-i) carries a 2026 JAN~NG qualifier; confirm the effective date." },
  "77": { cells: all("OK") }, "78": { cells: all("OK") },
  "60": { cells: std }, "61": { cells: std },
  "62": { cells: all("HOLD"), note: "Entry 8(j) carries a 2022~NG qualifier; confirm the effective date." },
  "43": { cells: all("NG") },
  "79": { cells: all("HOLD"), note: "Entry 8(k) carries 2024~ / 2026~NG qualifiers; confirm the effective date." },
  "15": { cells: all("NG") }, "63": { cells: all("OK") }, "64": { cells: all("OK") },
  "65": { cells: std }, "66": { cells: std },
  "17": { cells: all("NG") }, "18": { cells: all("NG") },
  "44": { cells: all("OK"), note: "Concentration within acceptable GADSL limits (threshold ≦0.1)." },
  "20": { cells: all("NG") },
  // Inactivated Application IDs
  "1": { cells: all("NG") }, "2": { cells: all("NG") }, "4": { cells: all("NG") }, "7": { cells: all("NG") },
  "9": { cells: all("NG") }, "13": { cells: all("NG") }, "14": { cells: all("NG") }, "16": { cells: all("NG") },
  "19": { cells: all("NG") }, "42": { cells: all("NG") }, "58": { cells: all("NG") }, "59": { cells: all("NG") }, "74": { cells: all("NG") }
};

export type PbPolicyResult =
  | { found: false; reason: string }
  | { found: true; outcome: Cell; applicationId: string; destination: PbDestination; note?: string };

export function lookupPbPolicy(applicationId: string, destination: string): PbPolicyResult {
  const id = String(applicationId || "").trim().replace(/\.0+$/, "");
  const dest = String(destination || "").trim().toUpperCase() as PbDestination;
  if (!id) return { found: false, reason: "Application ID is missing in the source row." };
  if (!PB_DESTINATIONS.includes(dest)) return { found: false, reason: "Select the vehicle destination." };
  const row = TABLE[id];
  if (!row) return { found: false, reason: `Application ID ${id} is not in the encoded Pb policy table.` };
  return { found: true, outcome: row.cells[PB_DESTINATIONS.indexOf(dest)], applicationId: id, destination: dest, note: row.note };
}
