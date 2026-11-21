#!/usr/bin/env node
// Dev-only UI audit: prints the design-debt metrics tracked in docs/DESIGN-SYSTEM.md.
// Usage: node scripts/audit-ui.mjs [--json]
// No dependencies; reads files only. Not part of the build.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const asJson = process.argv.includes("--json");

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const uniq = (a) => [...new Set(a)];
const count = (s, re) => (s.match(re) || []).length;
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;

function cssMetrics(css, label) {
  // Ignore hex inside tokens.css-style declarations only when counting "hex in rules".
  const hex = css.match(HEX) || [];
  const declHex = (css.match(/--[\w-]+\s*:[^;]*#[0-9a-fA-F]{3,8}/g) || []).length;
  const sizes = uniq([...css.matchAll(/(?:font-size\s*:\s*|font\s*:\s*(?:italic\s+)?(?:\d{3}\s+)?)(\d+(?:\.\d+)?)px/g)].map((m) => +m[1])).sort((a, b) => a - b);
  const weights = uniq([...css.matchAll(/font-weight\s*:\s*(\d{3})|font\s*:\s*(?:italic\s+)?(\d{3})\s/g)].map((m) => +(m[1] || m[2]))).sort((a, b) => a - b);
  const radii = uniq([...css.matchAll(/border-radius\s*:\s*([^;}{]+)/g)].map((m) => m[1].trim())).length;
  return {
    label,
    lines: css.split("\n").length,
    customProps: uniq(css.match(/--[\w-]+(?=\s*:)/g) || []).length,
    hexTotal: hex.length,
    hexUnique: uniq(hex.map((h) => h.toLowerCase())).length,
    hexInTokenDecls: declHex,
    fontSizes: sizes,
    fontWeights: weights,
    radiusValues: radii,
    border1pxSolid: count(css, /1px\s+solid/g),
    focusVisible: count(css, /:focus-visible/g),
    important: count(css, /!important/g)
  };
}

// Judgement CSS (globals + any tokens file)
const globals = read(join(root, "app/globals.css")) + read(join(root, "app/styles/tokens.css"));
const judgement = cssMetrics(globals, "Judgement (app/globals.css)");

// Tracker: split <style> from <script>
const tracker = read(join(root, "private/imds-tracker.html"));
const trackerCss = [...tracker.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
const trackerJs = [...tracker.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
const trackerM = cssMetrics(trackerCss, "Tracker (private/imds-tracker.html <style>)");
trackerM.lines = tracker.split("\n").length;
trackerM.hexInScript = (trackerJs.match(HEX) || []).length;
trackerM.innerHTMLWrites = count(trackerJs, /\.innerHTML\s*[+]?=/g) + count(trackerJs, /insertAdjacentHTML\s*\(/g);
trackerM.confirmCalls = count(trackerJs, /\bconfirm\s*\(/g);

// TSX
const tsx = [...walk(join(root, "app"), [".tsx"]), ...walk(join(root, "components"), [".tsx"])];
const tsxHex = [];
const tsxInline = [];
const tsxConfirm = [];
let dangerous = 0;
for (const f of tsx) {
  const s = read(f);
  const rel = relative(root, f);
  const h = (s.match(HEX) || []).length;
  if (h) tsxHex.push([rel, h]);
  const i = count(s, /style=\{\{/g);
  if (i) tsxInline.push([rel, i]);
  const c = count(s, /window\.confirm\s*\(|\bconfirm\s*\(/g);
  if (c) tsxConfirm.push([rel, c]);
  dangerous += count(s, /dangerouslySetInnerHTML/g);
}
const byCount = (a, b) => b[1] - a[1];

// Headers / CSP
const nextCfg = read(join(root, "next.config.ts"));
const proxy = read(join(root, "proxy.ts"));
const cspAnywhere = /Content-Security-Policy/i.test(nextCfg + proxy + read(join(root, "app/imds-tracker/route.ts")));
const googleFonts = count(globals + tracker, /fonts\.googleapis\.com|fonts\.gstatic\.com/g);

// Big components
const big = tsx.map((f) => [relative(root, f), read(f).split("\n").length]).filter(([, n]) => n > 400).sort(byCount);

const report = {
  measuredAt: new Date().toISOString().slice(0, 10),
  judgement,
  tracker: trackerM,
  tsx: {
    filesWithHex: tsxHex.sort(byCount),
    inlineStyle: tsxInline.sort(byCount),
    confirmCalls: tsxConfirm.sort(byCount),
    dangerouslySetInnerHTML: dangerous,
    over400Lines: big
  },
  security: { cspHeaderPresent: cspAnywhere, googleFontsRefs: googleFonts }
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const p = (m) => {
    console.log(`\n## ${m.label}`);
    for (const [k, v] of Object.entries(m)) if (k !== "label") console.log(`  ${k}: ${Array.isArray(v) ? `${v.length} → ${v.join(", ")}` : v}`);
  };
  console.log(`UI audit — ${report.measuredAt}`);
  p(judgement);
  p(trackerM);
  console.log("\n## TSX");
  console.log(`  files with hex (${tsxHex.length}): ${tsxHex.map(([f, n]) => `${f} ${n}`).join("; ")}`);
  console.log(`  inline style={{}} (${tsxInline.length} files): ${tsxInline.map(([f, n]) => `${f} ${n}`).join("; ")}`);
  console.log(`  confirm() (${tsxConfirm.length} files): ${tsxConfirm.map(([f, n]) => `${f} ${n}`).join("; ")}`);
  console.log(`  dangerouslySetInnerHTML: ${dangerous}`);
  console.log(`  files > 400 lines: ${big.map(([f, n]) => `${f} ${n}`).join("; ")}`);
  console.log("\n## Security");
  console.log(`  CSP header configured: ${cspAnywhere}`);
  console.log(`  Google Fonts references: ${googleFonts}`);
}
