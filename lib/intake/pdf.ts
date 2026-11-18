import { inflateSync } from "node:zlib";
import { isValidCas, normalizeCas } from "@/lib/cas";

/**
 * Minimal, dependency-free text reader for supplier PDFs (IMDS MDS reports, material declarations).
 * It inflates FlateDecode content streams and collects the strings drawn with Tj / TJ, one line per
 * text-positioning step. That is enough to find CAS numbers and percentages, which are plain ASCII digits.
 * Scanned PDFs, or PDFs whose fonts are re-encoded (CID / Identity-H), give no text. The caller then falls
 * back to attaching the PDF for Toyota to read, and nothing is guessed.
 */
const MAX_STREAM = 8 * 1024 * 1024, MAX_TOTAL = 24 * 1024 * 1024;

function unescapePdf(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e: string) => {
    const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
    return map[e] ?? String.fromCharCode(parseInt(e, 8));
  });
}

/** Text lines of every content stream in the file (best effort). */
export function pdfTextLines(buf: Buffer): string[] {
  const src = buf.toString("latin1");
  const lines: string[] = [];
  let total = 0;
  const re = /<<([^]*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf("endstream", start);
    if (end < 0) break;
    const dict = m[1];
    if (/\/Subtype\s*\/Image|\/Type\s*\/XObject[^]*\/Image/.test(dict)) { re.lastIndex = end; continue; }
    let raw = buf.subarray(start, end);
    let text = "";
    try {
      if (/\/FlateDecode/.test(dict)) raw = inflateSync(raw, { maxOutputLength: MAX_STREAM });
      else if (/\/Filter/.test(dict)) { re.lastIndex = end; continue; } // other filters (DCT, LZW…) are not text we can read
      total += raw.length; if (total > MAX_TOTAL) break;
      text = raw.toString("latin1");
    } catch { re.lastIndex = end; continue; }
    re.lastIndex = end;
    if (!/\b(?:Tj|TJ)\b/.test(text)) continue;
    let line = "";
    const tok = /\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|(T\*|Td|TD|Tm|ET)\b/g;
    let t: RegExpExecArray | null;
    while ((t = tok.exec(text))) {
      if (t[1] !== undefined) {
        // TJ array: strings and kerning numbers; a large negative kern is a word gap
        for (const part of t[1].matchAll(/\(((?:\\.|[^\\)])*)\)|(-?\d+(?:\.\d+)?)/g)) {
          if (part[1] !== undefined) line += unescapePdf(part[1]);
          else if (Number(part[2]) < -200) line += " ";
        }
      } else if (t[2] !== undefined) line += unescapePdf(t[2]);
      else { if (line.trim()) lines.push(line.replace(/\s+/g, " ").trim()); line = ""; }
    }
    if (line.trim()) lines.push(line.replace(/\s+/g, " ").trim());
  }
  return lines;
}

const CAS_RE = /\b\d{2,7}\s*-\s*\d{2}\s*-\s*\d\b/g;
const PART_RE = /(?:Part(?:\s*\/\s*Item)?\s*(?:No|Number)\.?|P\/No\.?|Delivery\s+Part\s+No\.?)\s*[:：]?\s*([A-Z0-9][A-Z0-9-]{4,24})/i;

/**
 * Turn PDF text into the self-check's table: one row per CAS found, with the substance name before it and
 * the first percentage after it on the same line. `partNo` from the user wins over one found in the text.
 */
export function pdfToMatrix(buf: Buffer, partNo = ""): { matrix: string[][]; lines: number; partFound: string } {
  const lines = pdfTextLines(buf);
  const found = lines.map((l) => PART_RE.exec(l)?.[1]).find(Boolean) || "";
  const part = partNo.trim() || found;
  const rows: string[][] = [["Delivery Part No.", "CAS No.", "Substance Name", "Substance Content(%)"]];
  const seen = new Set<string>();
  for (const l of lines) {
    for (const c of l.matchAll(CAS_RE)) {
      const cas = normalizeCas(c[0]);
      if (!isValidCas(cas)) continue;
      const before = l.slice(0, c.index).replace(/[|;,:]+\s*$/, "").trim();
      const after = l.slice((c.index ?? 0) + c[0].length);
      const pct = /(\d+(?:[.,]\d+)?)\s*%/.exec(after)?.[1] ?? /\b(\d{1,3}(?:[.,]\d+)?)\b/.exec(after)?.[1] ?? "";
      const k = `${cas}|${pct}|${before.slice(-60)}`;
      if (seen.has(k)) continue; seen.add(k);
      rows.push([part, cas, before.slice(-80), pct.replace(",", ".")]);
    }
  }
  return { matrix: rows.length > 1 ? rows : [], lines: lines.length, partFound: found };
}
