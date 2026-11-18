import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { pdfTextLines, pdfToMatrix } from "@/lib/intake/pdf";

function pdf(content: string, compress = true) {
  const body = compress ? deflateSync(Buffer.from(content, "latin1")) : Buffer.from(content, "latin1");
  const dict = compress ? `<< /Length ${body.length} /Filter /FlateDecode >>` : `<< /Length ${body.length} >>`;
  return Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj\n${dict}\nstream\n`, "latin1"), body, Buffer.from("\nendstream\nendobj\n%%EOF", "latin1")]);
}
const page = `BT /F1 10 Tf 50 750 Td (Part/Item No.: 86560-02160) Tj ET
BT 50 700 Td (Lead) Tj 120 0 Td (7439-92-1) Tj 80 0 Td (0.08 %) Tj ET
BT 50 680 Td [(Hexa) -50 (bromo) -400 (cyclododecane)] TJ 120 0 Td (25637-99-4) Tj 80 0 Td (1.5) Tj ET
BT 50 660 Td (Not a CAS 1234-56-7) Tj ET`;

describe("PDF text reader (no dependencies)", () => {
  it("reads strings from a compressed content stream, one line per positioning step", () => {
    const lines = pdfTextLines(pdf(page));
    expect(lines).toContain("Part/Item No.: 86560-02160");
    expect(lines).toContain("7439-92-1");
    expect(lines.some((l) => l.includes("Hexabromo cyclododecane"))).toBe(true);
  });
  it("turns CAS numbers into self-check rows; invalid check digits are dropped; the typed part number wins", () => {
    const flat = pdf("BT (Lead 7439-92-1 0.08 %) Tj ET BT (HBCDD 25637-99-4 1.5) Tj ET BT (bad 1234-56-7) Tj ET");
    const a = pdfToMatrix(flat);
    expect(a.matrix.slice(1).map((r) => [r[1], r[3]])).toEqual([["7439-92-1", "0.08"], ["25637-99-4", "1.5"]]);
    expect(pdfToMatrix(pdf(page)).partFound).toBe("86560-02160");
    expect(pdfToMatrix(flat, "P-TYPED").matrix[1][0]).toBe("P-TYPED");
  });
  it("a PDF without readable text gives no rows (the caller attaches it instead)", () => {
    expect(pdfToMatrix(Buffer.from("%PDF-1.4\n%%EOF")).matrix).toEqual([]);
    expect(pdfToMatrix(pdf("q 1 0 0 1 0 0 cm Q")).matrix).toEqual([]);
  });
});
