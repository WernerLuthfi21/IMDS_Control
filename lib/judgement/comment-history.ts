/**
 * Judge comments must stay consistent with what was written before: the same Error Type and the
 * same decision should carry the same wording, because TMA checks the result and it is then typed
 * into G-CATS. This module indexes the comments already saved in the register.
 */
export type HistoryRow = {
  error_type_label: string; delivery_part_no: string | null; judge: string | null;
  ok_comment: string | null; imds_reject_comment: string | null; comment_last_time?: string | null;
};
export type CommentUse = { comment: string; count: number };
export type CommentHistory = {
  /** errorType|decision → comments, most used first. */
  byType: Map<string, CommentUse[]>;
  /** PART|errorType → G-CATS "Comment(last time)" or the last comment saved here. */
  lastForPart: Map<string, string>;
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const partKey = (part: string | null, type: string) => (part || "").trim().toUpperCase() + "|" + type;
export const typeKey = (type: string, decision: string) => type + "|" + decision.toUpperCase();

export function buildCommentHistory(rows: HistoryRow[]): CommentHistory {
  const counts = new Map<string, Map<string, CommentUse>>();
  const lastForPart = new Map<string, string>();
  for (const r of rows) {
    const j = (r.judge || "").toUpperCase();
    const c = norm(j === "OK" ? r.ok_comment || "" : j === "NG" ? r.imds_reject_comment || "" : "");
    if ((j === "OK" || j === "NG") && c) {
      const k = typeKey(r.error_type_label, j);
      const m = counts.get(k) ?? new Map<string, CommentUse>();
      const lower = c.toLowerCase();
      const u = m.get(lower) ?? { comment: c, count: 0 };
      u.count++; m.set(lower, u); counts.set(k, m);
    }
    const last = norm(r.comment_last_time || "") || c;
    if (last && !lastForPart.has(partKey(r.delivery_part_no, r.error_type_label))) lastForPart.set(partKey(r.delivery_part_no, r.error_type_label), last);
  }
  const byType = new Map<string, CommentUse[]>();
  for (const [k, m] of counts) byType.set(k, [...m.values()].sort((a, b) => b.count - a.count || a.comment.localeCompare(b.comment)));
  return { byType, lastForPart };
}

export type Consistency =
  | { kind: "match"; count: number }
  | { kind: "new"; usual: CommentUse | null }
  | { kind: "empty" };

/** Is this comment one already used for the same Error Type and decision? */
export function checkComment(h: CommentHistory, errorType: string, decision: string, comment: string): Consistency {
  const c = norm(comment).toLowerCase();
  if (!c) return { kind: "empty" };
  const list = h.byType.get(typeKey(errorType, decision)) ?? [];
  const hit = list.find((u) => u.comment.toLowerCase() === c);
  return hit ? { kind: "match", count: hit.count } : { kind: "new", usual: list[0] ?? null };
}

export function lastComment(h: CommentHistory, part: string | null, errorType: string): string {
  return h.lastForPart.get(partKey(part, errorType)) || "";
}
