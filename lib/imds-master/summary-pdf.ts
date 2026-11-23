// Summary PDF for the "summary to all suppliers" e-mail: one landscape A4 report with the totals and one row per
// supplier that still has outstanding parts (total P/N, submitted, not submitted, rejected, working, % and due date).
// Built on the server (pdf-lib, standard Helvetica), so the weekly automation can attach it without a browser.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type SummaryRow = { supplier: string; code: string; total: number; submitted: number; missing: number; rejected: number; working: number; due: string };
export type SummaryInput = { title: string; subtitle: string; rows: SummaryRow[]; models: string[]; generatedAt: Date };

const ascii = (s: unknown) => String(s ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
const ink = rgb(0.12, 0.1, 0.17), muted = rgb(0.4, 0.37, 0.45), head = rgb(0.3, 0.11, 0.58), band = rgb(0.95, 0.93, 0.99), line = rgb(0.85, 0.83, 0.9), bad = rgb(0.7, 0.13, 0.2), ok = rgb(0.09, 0.45, 0.27);

function fit(font: PDFFont, text: string, size: number, width: number): string {
  let t = ascii(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + "...", size) > width) t = t.slice(0, -1);
  return t + "...";
}

export async function buildSummaryPdf(i: SummaryInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(ascii(i.title)); doc.setCreator("IMDS Tracker"); doc.setProducer("IMDS Tracker");
  const f = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 841.89, H = 595.28, M = 32;
  const cols: [string, number, "l" | "r"][] = [["No", 26, "r"], ["Supplier", 250, "l"], ["Code", 50, "l"], ["Total P/N", 62, "r"], ["Submitted", 66, "r"], ["Not submitted", 78, "r"], ["Rejected", 58, "r"], ["Working", 58, "r"], ["% submitted", 70, "r"], ["Due", 59, "l"]];
  const tot = i.rows.reduce((a, r) => ({ total: a.total + r.total, submitted: a.submitted + r.submitted, missing: a.missing + r.missing, rejected: a.rejected + r.rejected, working: a.working + r.working }), { total: 0, submitted: 0, missing: 0, rejected: 0, working: 0 });
  let page: PDFPage = doc.addPage([W, H]), y = H - M, pageNo = 1;
  const text = (p: PDFPage, t: string, x: number, yy: number, size: number, font: PDFFont, color = ink) => p.drawText(ascii(t), { x, y: yy, size, font, color });
  const footer = (p: PDFPage, n: number) => text(p, `Generated ${i.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC  -  IMDS Tracker, TMMIN Material Engineering  -  page ${n}`, M, 18, 7.5, f, muted);
  const header = () => {
    let x = M; page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 18, color: head });
    for (const [t, w, al] of cols) { const tw = b.widthOfTextAtSize(t, 8); text(page, t, al === "r" ? x + w - 4 - tw : x + 4, y - 11, 8, b, rgb(1, 1, 1)); x += w; }
    y -= 18;
  };
  // Title and totals
  text(page, i.title, M, y - 16, 16, b); y -= 22;
  text(page, i.subtitle, M, y - 10, 9, f, muted); y -= 24;
  const pct = tot.total ? Math.round((tot.submitted / tot.total) * 100) : 0;
  const kpis: [string, string, typeof ink][] = [["Suppliers with open parts", String(i.rows.length), ink], ["Total P/N", String(tot.total), ink], ["Submitted", `${tot.submitted} (${pct}%)`, ok], ["Not submitted", String(tot.missing), bad], ["Rejected", String(tot.rejected), bad], ["Working", String(tot.working), ink]];
  const kw = (W - 2 * M - 5 * 8) / 6;
  kpis.forEach(([l, v, c], n) => { const x = M + n * (kw + 8); page.drawRectangle({ x, y: y - 40, width: kw, height: 40, color: band, borderColor: line, borderWidth: 0.6 }); text(page, l, x + 8, y - 13, 7.5, f, muted); text(page, v, x + 8, y - 32, 14, b, c); });
  y -= 52;
  if (i.models.length) { text(page, "Models: " + i.models.join(", "), M, y - 8, 8.5, f, muted); y -= 16; }
  header();
  i.rows.forEach((r, n) => {
    if (y < M + 24) { footer(page, pageNo); page = doc.addPage([W, H]); pageNo++; y = H - M; header(); }
    const rowH = 16; if (n % 2) page.drawRectangle({ x: M, y: y - rowH, width: W - 2 * M, height: rowH, color: rgb(0.985, 0.98, 0.995) });
    page.drawLine({ start: { x: M, y: y - rowH }, end: { x: W - M, y: y - rowH }, thickness: 0.4, color: line });
    const p = r.total ? Math.round((r.submitted / r.total) * 100) : 0;
    const vals = [String(n + 1), r.supplier, r.code || "-", String(r.total), String(r.submitted), String(r.missing), String(r.rejected), String(r.working), p + "%", r.due || "-"];
    let x = M;
    cols.forEach(([, w, al], c) => {
      const font = c === 1 ? b : f, color = c === 5 && r.missing ? bad : c === 6 && r.rejected ? bad : c === 8 ? (p >= 80 ? ok : p < 50 ? bad : ink) : ink;
      const t = fit(font, vals[c], 8, w - 8), tw = font.widthOfTextAtSize(t, 8);
      text(page, t, al === "r" ? x + w - 4 - tw : x + 4, y - 11, 8, font, color); x += w;
    });
    y -= rowH;
  });
  if (!i.rows.length) text(page, "No supplier has outstanding parts.", M + 4, y - 14, 9, f, muted);
  footer(page, pageNo);
  return Buffer.from(await doc.save());
}
