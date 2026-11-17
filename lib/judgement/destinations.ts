/** TMMIN vehicle destination codes → the region the Toyota rules are written for (from Jasmine's G-CATS Auto-Judgement, owner-confirmed). */
export const DEST_CODES: Array<[code: string, label: string, region: "EU" | "KR" | "CN" | "TW" | "IN" | "JP" | "OTH"]> = [
  ["JP", "No code — Japan", "JP"], ["GEXP", "No code — General Export", "OTH"], ["A", "A — US", "OTH"], ["B", "B — Turkey", "EU"],
  ["C", "C — China", "CN"], ["D", "D — Indonesia", "OTH"], ["E", "E — Malaysia", "OTH"], ["F", "F — Venezuela", "OTH"], ["G", "G — Brazil", "OTH"],
  ["H", "H — Argentina", "OTH"], ["J", "J — Kenya", "OTH"], ["L", "L — Columbia", "OTH"], ["M", "M — Philippines", "OTH"], ["N", "N — South Africa", "OTH"],
  ["P", "P — Pakistan", "OTH"], ["Q", "Q — Australia", "OTH"], ["R", "R — Taiwan", "TW"], ["T", "T — Thailand", "OTH"], ["U", "U — Vietnam", "OTH"],
  ["V_IL", "V — Middle and Near East (Israel)", "EU"], ["V", "V — Middle and Near East (other countries)", "OTH"], ["W", "W — Europe", "EU"],
  ["X_RU", "X — Russia", "OTH"], ["X_IN", "X — India", "IN"], ["Z", "Z — New Zealand", "OTH"], ["KR", "Korea", "KR"]
];
export const regionOfCode = (code: string) => DEST_CODES.find(([c]) => c === code)?.[2];
