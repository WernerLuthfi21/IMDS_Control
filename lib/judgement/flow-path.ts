import type { FlowChartNode, FlowRun } from "@/lib/judgement/flows";

/**
 * Follow one case's evaluation trail through a drawn flow chart, so the Rules page can light up
 * the exact path the engine took for that case.
 *
 * The chart is drawn with blank row facts, so a check the case answered automatically from the row
 * (content %, Application ID, material…) appears in the chart as a question with a slightly different
 * wording ("Application ID is 20 …?" on the case, "Is the Application ID 20 …?" in the chart). We
 * therefore match questions by word overlap and answers by label, and stop — reporting an incomplete
 * path — the moment a step cannot be matched. Nothing is guessed past that point.
 */
export type TrailStep = Pick<FlowRun["trail"][number], "question" | "answer">;
export type TracedPath = {
  /** Keys of the nodes on the path: "r" for the root, then "r.<branch index>" per step. */
  nodes: string[];
  /** Branch keys taken (same key as the child node). */
  branches: string[];
  /** How many trail steps were matched to a chart question. */
  matched: number;
  /** True when the path ends on a result node. */
  complete: boolean;
};

const STOP = new Set(["is", "the", "a", "an", "of", "in", "to", "for", "confirm", "does", "do", "it", "this", "row", "from", "and", "or", "be", "by"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9.%+]+/g, " ").split(" ").filter((w) => w && !STOP.has(w));
function similarity(a: string, b: string): number {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.max(A.size, B.size);
}
/** "12 from the row → Yes (auto)" → "yes"; "A · Input mistake" → "a · input mistake". */
export const answerOf = (a: string) => a.replace(/^.*→\s*/, "").replace(/\s*\(auto\)\s*$/, "").trim().toLowerCase();
function labelMatches(label: string, ans: string): boolean {
  const l = label.trim().toLowerCase();
  if (l === ans) return true;
  const head = (s: string) => s.split(/\s*·\s*/)[0];
  return head(l) === head(ans) && head(l).length > 0 && (l.includes("·") || ans.includes("·"));
}

export function tracePath(root: FlowChartNode, trail: TrailStep[], minSimilarity = 0.5): TracedPath {
  const out: TracedPath = { nodes: ["r"], branches: [], matched: 0, complete: false };
  let node = root, key = "r", cursor = 0, guard = 0;
  while (guard++ < 64) {
    if (node.outcome) { out.complete = true; break; }
    if (!node.question || !node.branches.length) break;
    // best trail step from the cursor on that asks this question
    let best = -1, score = 0;
    for (let i = cursor; i < trail.length; i++) {
      const s = similarity(node.question.text, trail[i].question);
      if (s > score) { score = s; best = i; }
    }
    if (best < 0 || score < minSimilarity) break;
    const ans = answerOf(trail[best].answer);
    const bi = node.branches.findIndex((b) => b.labels.some((l) => labelMatches(l, ans)));
    if (bi < 0) break;
    out.matched++;
    cursor = best + 1;
    key = key + "." + bi;
    out.branches.push(key);
    out.nodes.push(key);
    node = node.branches[bi].node;
  }
  return out;
}

/** Compact URL form of a trail: only the question and the final answer, JSON + base64url. */
export function encodeTrail(trail: TrailStep[]): string {
  const json = JSON.stringify(trail.map((t) => [t.question, answerOf(t.answer)]));
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeTrail(s: string | null | undefined): TrailStep[] {
  if (!s) return [];
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, "base64").toString("utf8");
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "string").slice(0, 40).map(([question, answer]) => ({ question, answer }));
  } catch { return []; }
}
