import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_REQUIRED_CC, KINDS, PLACEHOLDERS, cleanFont, footerFor, mergeCc, sanitizeConfig } from "@/lib/followup/center";

describe("default templates", () => {
  it("has one default template for each of the three kinds", () => {
    for (const k of KINDS) {
      const t = DEFAULT_CONFIG.templates.find((x) => x.id === DEFAULT_CONFIG.defaults[k]);
      expect(t?.kind).toBe(k);
    }
  });
  it("only uses placeholders that the e-mail center can fill", () => {
    const allowed = new Set<string>(PLACEHOLDERS);
    for (const t of DEFAULT_CONFIG.templates) for (const m of (t.subject + t.body).match(/\{[a-z]+\}/g) ?? []) expect(allowed.has(m), `${t.id} uses ${m}`).toBe(true);
  });
  it("makes the three management addresses mandatory by default", () => {
    expect(DEFAULT_CONFIG.requiredCc.map((e) => e.toLowerCase())).toEqual(expect.arrayContaining(["fuad-qc@toyota.co.id", "hendrick.kurdianto@toyota.co.id", "michael.aldryan@toyota.co.id"]));
  });
});

describe("sanitizeConfig", () => {
  it("falls back to the built-in templates for empty or invalid input", () => {
    for (const bad of [null, undefined, 5, {}, { templates: "x" }]) {
      const c = sanitizeConfig(bad);
      for (const k of KINDS) expect(c.templates.some((t) => t.kind === k)).toBe(true);
      expect(c.requiredCc).toEqual(DEFAULT_REQUIRED_CC.map((e) => e.toLowerCase()));
    }
  });
  it("keeps edited templates, repairs a default that no longer exists and drops invalid e-mail addresses", () => {
    const c = sanitizeConfig({ templates: [{ id: "a", kind: "request", name: "A", subject: "S", body: "B" }], defaults: { request: "gone" }, requiredCc: ["x@y.com", "nonsense"] });
    expect(c.defaults.request).toBe("a");
    expect(c.requiredCc).toEqual(["x@y.com"]);
    for (const k of KINDS) expect(c.templates.some((t) => t.kind === k)).toBe(true);
  });
  it("an explicitly empty required list stays empty (the owner decided)", () => {
    expect(sanitizeConfig({ requiredCc: [] }).requiredCc).toEqual([]);
  });
  it("rejects duplicate ids and unknown kinds become follow-up", () => {
    const c = sanitizeConfig({ templates: [{ id: "a", kind: "zzz", name: "A", subject: "S", body: "B" }, { id: "a", kind: "request", name: "B", subject: "S", body: "B" }] });
    expect(c.templates.filter((t) => t.id === "a")).toHaveLength(1);
    expect(c.templates.find((t) => t.id === "a")?.kind).toBe("followup");
  });
});

describe("mergeCc", () => {
  it("always adds the required list, never the sender or a recipient, without duplicates", () => {
    const cc = mergeCc({ to: ["p@a.com"], cc: ["P@a.com", "boss@x.com", "me@x.com", "Boss@x.com"], required: ["boss@x.com", "req@x.com"], senderEmail: "ME@x.com" });
    expect(cc).toEqual(["boss@x.com", "req@x.com"]);
  });
  it("re-adds a required address the browser removed", () => {
    expect(mergeCc({ to: ["p@a.com"], cc: [], required: ["req@x.com"] })).toEqual(["req@x.com"]);
  });
});

import { DEFAULT_SIGNATURE, sanitizeConfig as cleanCfg, withSignature } from "@/lib/followup/center";
describe("sign-off under every e-mail", () => {
  it("is on by default with the full sender name placeholder", () => {
    const c = cleanCfg({});
    expect(c.signature).toBe(DEFAULT_SIGNATURE);
    expect(c.signature).toContain("{sendername}");
    expect(c.senderNames.Werner).toBe("Abdullah Luthfi Werner");
  });
  it("is added once; a template that already signs off keeps its own", () => {
    const sig = "Best regards,\n\nAbdullah Luthfi Werner\nTMMIN - Material Engineering";
    expect(withSignature("Dear X,\n\nThank you.", sig)).toBe("Dear X,\n\nThank you.\n\n" + sig);
    expect(withSignature("Dear X,\n\nKind regards,\nAyu", sig)).toBe("Dear X,\n\nKind regards,\nAyu");
    expect(withSignature("Dear X", "")).toBe("Dear X");
  });
  it("an emptied signature stays empty and names are sanitised", () => {
    const c = cleanCfg({ signature: "", senderNames: { Werner: "  Abdullah Luthfi Werner ", "": "x", Bad: "" } });
    expect(c.signature).toBe("");
    expect(c.senderNames).toEqual({ Werner: "Abdullah Luthfi Werner" });
  });
});

import { fullSenderName, signOff } from "@/lib/followup/center";
describe("server-side sign-off (safety net for both e-mail routes)", () => {
  const cfg = cleanCfg({});
  it("fills the full name for a known sender, case-insensitive", () => {
    expect(fullSenderName(cfg.senderNames, "werner")).toBe("Abdullah Luthfi Werner");
    expect(fullSenderName(cfg.senderNames, "Jasmin")).toBe("Jasmin");
    expect(signOff("Dear X,\n\nThank you.", cfg, "Werner")).toBe("Dear X,\n\nThank you.\n\nBest regards,\n\nAbdullah Luthfi Werner\nTMMIN - Material Engineering");
  });
  it("drops the name line when no sender is known, never sending an empty line", () => {
    expect(signOff("Hi", cfg, null)).toBe("Hi\n\nBest regards,\n\nTMMIN - Material Engineering");
  });
  it("does not sign a body the page already signed", () => {
    const once = signOff("Hi", cfg, "Werner");
    expect(signOff(once, cfg, "Werner")).toBe(once);
  });
});

describe("footer per sender and e-mail font", () => {
  const cfg = sanitizeConfig({ signature: "Best regards,\n\n{sendername}", senderNames: { Werner: "Abdullah Luthfi Werner", Ayu: "Eka Tarisa Ayu Putri" }, senderFooters: { werner: "Regards,\n{sendername}\nIMDS PIC · Ext. 1234", "": "x" } });
  it("keeps only named footers and defaults to none", () => {
    expect(cfg.senderFooters).toEqual({ werner: "Regards,\n{sendername}\nIMDS PIC · Ext. 1234" });
    expect(sanitizeConfig({}).senderFooters).toEqual({});
  });
  it("uses the sender's own footer (any case), otherwise the shared signature", () => {
    expect(footerFor(cfg, "Werner")).toContain("IMDS PIC");
    expect(footerFor(cfg, "Ayu")).toBe("Best regards,\n\n{sendername}");
    expect(footerFor(cfg, "")).toBe("Best regards,\n\n{sendername}");
    expect(signOff("Body", cfg, "Werner")).toBe("Body\n\nRegards,\nAbdullah Luthfi Werner\nIMDS PIC · Ext. 1234");
    expect(signOff("Body", cfg, "Ayu")).toBe("Body\n\nBest regards,\n\nEka Tarisa Ayu Putri");
  });
  it("accepts only a known font family and a readable size", () => {
    expect(sanitizeConfig({}).font).toEqual({ family: "Calibri", sizePt: 11 });
    expect(cleanFont({ family: "segoe ui", sizePt: "12" })).toEqual({ family: "Segoe UI", sizePt: 12 });
    expect(cleanFont({ family: "Comic;x", sizePt: 40 })).toEqual({ family: "Calibri", sizePt: 11 });
  });
});
