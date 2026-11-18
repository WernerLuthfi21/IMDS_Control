import { isWorking } from "@/lib/judgement/piles";
import { NEED_LABEL, NEED_ORDER, type ReviewNeed } from "@/lib/judgement/review";

/** Register fields the overview needs. Counts only; no judgement is derived here. */
export type OverviewRow = {
  error_type_label: string;
  supplier_code: string | null;
  delivery_part_no: string | null;
  source_status: string | null;
  judge: string | null;
  km_judge: string | null;
};

export type Band = { key: "ok" | "ng" | "pending" | "other"; label: string; n: number };
export type SupplierLine = { code: string; ok: number; ng: number; pending: number; all: number };
export type TypeLine = { label: string; open: number; judged: number; all: number };

export type RegisterSummary = {
  total: number;
  judged: number;
  pending: number;
  km: number;
  pct: number;
  parts: number;
  band: Band[];
  suppliers: SupplierLine[];
  types: TypeLine[];
};

const isPending = (r: OverviewRow) => isWorking(r.source_status) && !r.judge;

/** Totals for the overview hero, KPI tiles, supplier table and error-type bars. */
export function summarizeRegister(rows: OverviewRow[], topSuppliers = 8, topTypes = 8): RegisterSummary {
  let ok = 0, ng = 0, pending = 0, km = 0;
  const parts = new Set<string>();
  const sup = new Map<string, SupplierLine>();
  const types = new Map<string, TypeLine>();
  for (const r of rows) {
    const j = (r.judge || "").toUpperCase();
    if (j === "OK") ok++; else if (j === "NG") ng++;
    if (r.judge && !r.km_judge) km++;
    const open = isPending(r);
    if (open) pending++;
    if (r.delivery_part_no) parts.add(r.delivery_part_no.trim().toUpperCase());

    const code = (r.supplier_code || "").trim() || "—";
    const s = sup.get(code) ?? { code, ok: 0, ng: 0, pending: 0, all: 0 };
    s.all++; if (j === "OK") s.ok++; else if (j === "NG") s.ng++; if (open) s.pending++;
    sup.set(code, s);

    const label = r.error_type_label || "Unlabelled";
    const t = types.get(label) ?? { label, open: 0, judged: 0, all: 0 };
    t.all++; if (open) t.open++; if (r.judge) t.judged++;
    types.set(label, t);
  }
  const judged = rows.filter((r) => Boolean(r.judge)).length;
  const total = rows.length;
  // Every row lands in exactly one band: OK, NG, still to judge, or anything else
  // (not WORKING without a judge, or a judge value other than OK/NG).
  const other = Math.max(0, total - ok - ng - pending);
  return {
    total, judged, pending, km,
    pct: total ? Math.round((judged / total) * 100) : 0,
    parts: parts.size,
    band: [
      { key: "ok", label: "OK", n: ok },
      { key: "ng", label: "NG", n: ng },
      { key: "pending", label: "To judge", n: pending },
      { key: "other", label: "Other", n: other }
    ],
    suppliers: [...sup.values()].filter((s) => s.pending > 0)
      .sort((a, b) => b.pending - a.pending || b.all - a.all || a.code.localeCompare(b.code)).slice(0, topSuppliers),
    types: [...types.values()]
      .sort((a, b) => b.open - a.open || b.all - a.all || a.label.localeCompare(b.label)).slice(0, topTypes)
  };
}

export type NeedCounts = Partial<Record<ReviewNeed, number>>;
export type Attention = { key: string; severity: "red" | "amber" | "blue"; n: number; headline: string; label: string; need?: ReviewNeed; tab?: "km" };

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/**
 * What needs attention first: blockers outside the reviewer's hands (supplier, purchasing,
 * TMC, missing data) outrank internal ones; within a severity the biggest pile comes first.
 */
export function attentionItems(needs: NeedCounts | null, km: number): Attention[] {
  const n = (k: ReviewNeed) => needs?.[k] ?? 0;
  const yourAnswer = n("destination") + n("check") + n("drawing");
  const items: Attention[] = [
    { key: "supplier", severity: "red", n: n("supplier"), headline: `${plural(n("supplier"), "case")} waiting on a supplier answer`, label: "Waiting on a supplier answer", need: "supplier" },
    { key: "tmc", severity: "red", n: n("tmc"), headline: `${plural(n("tmc"), "case")} on hold for TMC / TMNA confirmation`, label: "On hold — confirm to TMC / TMNA", need: "tmc" },
    { key: "purchasing", severity: "red", n: n("purchasing"), headline: `${plural(n("purchasing"), "case")} waiting on Purchasing`, label: "Waiting on Purchasing", need: "purchasing" },
    { key: "missing", severity: "red", n: n("missing"), headline: `${plural(n("missing"), "case")} missing source data`, label: "Missing source data", need: "missing" },
    { key: "ready", severity: "amber", n: n("ready"), headline: `${plural(n("ready"), "case")} ready for you to confirm`, label: "Ready to confirm", need: "ready" },
    { key: "answer", severity: "amber", n: yourAnswer, headline: `${plural(yourAnswer, "case")} waiting for your answer`, label: "Waiting for your answer", need: n("destination") >= n("check") && n("destination") >= n("drawing") ? "destination" : n("check") >= n("drawing") ? "check" : "drawing" },
    { key: "manual", severity: "amber", n: n("manual"), headline: `${plural(n("manual"), "case")} need a human decision`, label: "Need a human decision", need: "manual" },
    { key: "km", severity: "blue", n: km, headline: `${plural(km, "judged case")} waiting for the KM judge`, label: "Awaiting KM judge", tab: "km" }
  ];
  const rank = { red: 0, amber: 1, blue: 2 } as const;
  return items.filter((x) => x.n > 0).sort((a, b) => rank[a.severity] - rank[b.severity] || b.n - a.n);
}

/** Review piles as bottleneck bars, biggest first. */
export function bottlenecks(needs: NeedCounts | null): Array<{ need: ReviewNeed; label: string; n: number }> {
  return NEED_ORDER.map((need) => ({ need, label: NEED_LABEL[need].title, n: needs?.[need] ?? 0 }))
    .filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
}
