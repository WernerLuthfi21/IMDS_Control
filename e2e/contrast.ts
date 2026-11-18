import type { Page } from "@playwright/test";

export type Violation = { text: string; where: string; ratio: number; need: number; fg: string; bg: string };

/**
 * WCAG contrast audit of every visible text node on the page. Backgrounds are composited through
 * semi-transparent ancestors; for gradients the worst colour stop is used. Disabled and aria-hidden
 * content is skipped (WCAG exempts inactive UI and decoration). Large text (≥24px, or ≥18.66px bold)
 * needs 3:1, everything else 4.5:1.
 */
export async function auditContrast(page: Page): Promise<Violation[]> {
  return page.evaluate(() => {
    type RGBA = [number, number, number, number];
    const parse = (c: string): RGBA[] => [...c.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1] as RGBA;
    });
    const over = (top: RGBA, under: RGBA): RGBA => {
      const a = top[3] + under[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a) as RGBA;
    };
    const lum = (c: RGBA) => {
      const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const ratio = (a: RGBA, b: RGBA) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    /** All candidate backgrounds behind `el` (several when a gradient is involved). */
    const backgrounds = (el: Element | null): RGBA[] => {
      const layers: RGBA[][] = [];
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        const stops = cs.backgroundImage && cs.backgroundImage !== "none" ? parse(cs.backgroundImage) : [];
        const color = parse(cs.backgroundColor)[0] ?? [0, 0, 0, 0];
        const here = stops.length ? stops.map((s) => over(s, color)) : [color];
        layers.push(here);
        if (here.every((c) => c[3] >= 0.999)) break;
      }
      let acc: RGBA[] = [[255, 255, 255, 1]];
      for (const layer of layers.reverse()) acc = layer.flatMap((top) => acc.map((under) => over(top, under)));
      return acc;
    };
    const out: Array<{ text: string; where: string; ratio: number; need: number; fg: string; bg: string }> = [];
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent || "").trim();
      const el = n.parentElement;
      if (!text || !el || seen.has(el)) continue;
      seen.add(el);
      if (el.closest("script,style,noscript,[aria-hidden='true'],:disabled,[aria-disabled='true'],[hidden],nextjs-portal,.sr-only")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      let opacity = 1;
      for (let e: Element | null = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
      if (opacity < 0.05) continue;
      const fg0 = parse(cs.color)[0]; if (!fg0) continue;
      const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      let worst = Infinity; let worstBg: RGBA = [255, 255, 255, 1]; let worstFg: RGBA = fg0;
      for (const bg of backgrounds(el)) {
        const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * opacity], bg);
        const v = ratio(fg, bg);
        if (v < worst) { worst = v; worstBg = bg; worstFg = fg; }
      }
      if (worst + 0.01 < need) {
        const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 2).join(".") : "";
        out.push({ text: text.slice(0, 50), where: el.tagName.toLowerCase() + (cls ? "." + cls : ""), ratio: Math.round(worst * 100) / 100, need,
          fg: worstFg.slice(0, 3).map(Math.round).join(","), bg: worstBg.slice(0, 3).map(Math.round).join(",") });
      }
    }
    return out;
  });
}
