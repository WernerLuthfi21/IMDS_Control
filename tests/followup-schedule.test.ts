import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { BUILTIN_BUYERS, findEntry, resolveContacts, type Directory } from "@/lib/followup/directory";
import { classifyStatus, dateLong, maskProj, modelKey, renderSupplierEmail, TEAM } from "@/lib/followup/render";
import { DEFAULT_SCHEDULE, isDue, nextRuns, sanitizeSchedule, wibSlot } from "@/lib/followup/schedule";
import { autoCheckFormula, buildCheckFormXlsx, imdsSupplierCode } from "@/lib/followup/check-form";
import { DEFAULT_CONFIG, sanitizeConfig } from "@/lib/followup/center";

// FIXTURE directory, invented names and addresses.
const dir: Directory = {
  entries: {
    "ALPHA PARTS": { name: "ALPHA PARTS", code: "9001", f: { pic1_email: "pic@alpha.test", staff_email: "staff@alpha.test", gm_email: "gm@alpha.test", md_email: "md@alpha.test", pd_email: "pd@alpha.test", buyer: "Puguh" }, x: [{ name: "Cc Person", email: "cc@alpha.test", role: "cc" }, { name: "Also To", email: "to2@alpha.test", role: "to" }] },
    "BETA COMPONENTS": { name: "BETA COMPONENTS", code: "9002", f: { dph_email: "dph@beta.test", gm_email: "gm@beta.test" } },
    "GAMMA": { name: "GAMMA", code: "", f: {} }
  },
  buyers: { Puguh: { full: "W. Puguh" } },
  aliases: { "ALPHA PART INDONESIA": "ALPHA PARTS" }
};

describe("directory contacts", () => {
  it("finds an entry by vendor code, alias and name", () => {
    expect(findEntry(dir, "anything", "9002")?.key).toBe("BETA COMPONENTS");
    expect(findEntry(dir, "PT. Alpha Part Indonesia")?.how).toBe("linked");
    expect(findEntry(dir, "Gamma")?.key).toBe("GAMMA");
  });
  it("splits the strata: PIC + 'to' contacts in To, 'cc' contacts always on CC, director apart from top management", () => {
    const c = resolveContacts(dir, "ALPHA PARTS", { vendorCode: "9001" });
    expect(c.to).toEqual(["pic@alpha.test", "to2@alpha.test"]);
    expect(c.ccAlways).toEqual(["cc@alpha.test"]);
    expect(c.mid).toEqual(["staff@alpha.test", "gm@alpha.test"]);
    expect(c.top).toEqual(["md@alpha.test"]);
    expect(c.dir).toEqual(["pd@alpha.test"]);
    expect(c.toFrom).toBe("pic");
  });
  it("uses the built-in buyer e-mail when the Directory has none", () => {
    expect(resolveContacts(dir, "ALPHA PARTS").buyer).toEqual({ short: "Puguh", name: "W. Puguh", emails: ["wahyu.bakhtiar@toyota.co.id"] });
  });
  it("falls back to middle management when there is no IMDS PIC (staff/supervisor first, else department head / GM)", () => {
    const c = resolveContacts(dir, "BETA COMPONENTS");
    expect(c.to).toEqual(["dph@beta.test", "gm@beta.test"]);
    expect(c.toFrom).toBe("mid");
    expect(c.mid).toEqual([]);
    expect(resolveContacts(dir, "BETA COMPONENTS", { fallbackMid: false }).to).toEqual([]);
  });
  it("uses the master e-mail last, and says when nothing is found", () => {
    expect(resolveContacts(dir, "GAMMA", { masterEmail: "m@gamma.test" })).toMatchObject({ to: ["m@gamma.test"], toFrom: "master" });
    expect(resolveContacts(dir, "UNKNOWN CO").toFrom).toBe("none");
  });
});

describe("server rendering matches the Tracker rules", () => {
  it("classifies IMDS STATUS like the Tracker", () => {
    expect(classifyStatus("")).toBe("missing");
    expect(classifyStatus("Not Submitted Yet")).toBe("missing");
    expect(classifyStatus("REJECTED")).toBe("rejected");
    expect(classifyStatus("STOP RUN")).toBe("stop");
    expect(classifyStatus("CHECK")).toBe("review");
    expect(classifyStatus("Accepted")).toBe("complete");
    expect(classifyStatus("Not accepted")).toBe("review");
    expect(classifyStatus("Working")).toBe("process");
    expect(modelKey(" 737 - d ")).toBe("737-D");
    expect(modelKey("#N/A")).toBe("UNASSIGNED");
  });
  it("masks project numbers and writes long dates", () => {
    expect(maskProj("737D")).toBe("7*7D");
    expect(dateLong("2026-11-23")).toBe("23rd November 2026");
    expect(dateLong("2026-12-11")).toBe("11th December 2026");
  });
  it("fills the template with supplier due dates, parts and the sender's sign-off", () => {
    const cfg = sanitizeConfig({});
    const t = cfg.templates.find((x) => x.id === cfg.defaults.followup)!;
    const out = renderSupplierEmail({
      template: t, config: cfg, kind: "followup", supplier: "ALPHA PARTS", code: "9001", sender: "Werner", now: new Date("2026-11-23T02:00:00Z"),
      due: { models: { "737D": "2026-11-25" }, suppliers: { "ALPHA PARTS|737D": "2026-11-30" } },
      parts: [{ partNo: "FX-2", partName: "PART B (FIXTURE)", model: "737D", status: "rejected", target: "2026-11-01" }, { partNo: "FX-1", partName: "PART A (FIXTURE)", model: "737D", status: "missing", target: null }]
    });
    expect(out.subject).toBe("IMDS Reminder – ALPHA PARTS – Please Submit (2 part(s))");
    expect(out.body).toContain("Good Morning.");
    expect(out.body).toContain("- 7*7D Project no later than 30th November 2026");
    expect(out.body).toContain("1. FX-2 — PART B (FIXTURE) — REJECTED, please resubmit — PAST DUE\n2. FX-1 — PART A (FIXTURE)");
    expect(out.body).toContain("Abdullah Luthfi Werner");
  });
});

describe("weekly schedule", () => {
  it("is off by default and keeps only valid days, hour and limits", () => {
    expect(sanitizeConfig({}).schedule).toEqual(DEFAULT_SCHEDULE);
    const s = sanitizeSchedule({ enabled: true, days: [1, 1, 9, "3"], hour: 25, maxSuppliers: 0, kind: "x", models: [" 737d "] });
    expect(s).toMatchObject({ enabled: true, days: [1, 3], hour: 9, maxSuppliers: 60, kind: "followup", models: ["737D"] });
  });
  it("uses WIB days and hours", () => {
    // Monday 23 Nov 2026 09:20 WIB = 02:20 UTC
    expect(wibSlot(new Date("2026-11-23T02:20:00Z"))).toEqual({ date: "2026-11-23", dow: 1, hour: 9, key: "2026-11-23@09" });
    // Sunday 22 Nov 2026 23:30 UTC = Monday 06:30 WIB
    expect(wibSlot(new Date("2026-11-22T23:30:00Z")).dow).toBe(1);
  });
  it("is due only on the chosen days within the chosen hour", () => {
    const s = sanitizeSchedule({ enabled: true, days: [1, 4], hour: 9 });
    expect(isDue(s, new Date("2026-11-23T02:59:00Z"))).toBe(true);   // Mon 09:59 WIB
    expect(isDue(s, new Date("2026-11-23T03:00:00Z"))).toBe(false);  // Mon 10:00 WIB
    expect(isDue(s, new Date("2026-11-24T02:10:00Z"))).toBe(false);  // Tue
    expect(isDue({ ...s, enabled: false }, new Date("2026-11-23T02:10:00Z"))).toBe(false);
  });
  it("lists the next runs", () => {
    const s = sanitizeSchedule({ enabled: true, days: [1, 4], hour: 9 });
    expect(nextRuns(s, new Date("2026-11-23T05:00:00Z"), 2).map((d) => d.toISOString())).toEqual(["2026-11-26T02:00:00.000Z", "2026-11-30T02:00:00.000Z"]);
    expect(nextRuns({ ...s, enabled: false }, new Date())).toEqual([]);
  });
  it("vercel.json registers one daily job per hour (Hobby plan allows daily jobs only)", () => {
    const v = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(v.crons).toHaveLength(24);
    expect(new Set(v.crons.map((c) => c.schedule.split(" ")[1]))).toEqual(new Set(Array.from({ length: 24 }, (_, h) => String(h))));
    for (const c of v.crons) { expect(c.path).toBe("/api/cron/followups"); expect(c.schedule).toMatch(/^\d+ \d+ \* \* \*$/); }
  });
});

describe("supplier check form", () => {
  it("builds the IMDS supplier code from the vendor code", () => {
    expect(imdsSupplierCode("0003")).toBe("Z0080003");
    expect(imdsSupplierCode("T007")).toBe("Z008T007");
    expect(imdsSupplierCode("12345")).toBe("");
  });
  it("auto-check formula lists every problem and says OK otherwise", () => {
    const f = autoCheckFormula(8);
    expect(f).toContain('"Not filled yet"');
    expect(f).toContain('K8<>0');
    expect(f).toContain('S8>=10');
    expect(f).toContain('"OK"');
  });
  it("fills the four sheets with the supplier's parts, earlier findings and contacts", async () => {
    const buf = await buildCheckFormXlsx({
      supplierName: "ALPHA PARTS", supplierCode: "9001", generatedAt: new Date("2026-11-23T00:00:00Z"),
      parts: [{ part_no: "FX-1000", part_name: "PART (FIXTURE)", project: "737D", imds_id_version: "123/1", submission_plan: "2026-11-30" }, { part_no: "=HYPERLINK(1)", part_name: "x" }],
      findings: { FX1000: ["Error Type 5 · CAS 7439-92-1"] },
      contacts: [{ role: "PIC #1", name: "Fixture Person", email: "pic@alpha.test" }]
    });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Guide & Instruction", "1. IMDS Checking List", "2. IMDS Information Form", "3. Contact Person (Updated)"]);
    const f = wb.getWorksheet("2. IMDS Information Form")!;
    expect(f.getCell("B8").value).toBe("Z0089001");
    expect(f.getCell("D8").value).toBe("FX-1000");
    expect(f.getCell("G8").value).toBe("123/1");
    expect((f.getCell("K8").value as { formula: string }).formula).toBe('IF(AND(I8<>"",J8<>""),I8-J8,"")');
    expect((f.getCell("AB8").value as { formula: string }).formula).toBe(autoCheckFormula(8));
    expect(f.getCell("AC8").value).toBe("Error Type 5 · CAS 7439-92-1");
    expect(f.getCell("AD8").value).toBe("737D · plan 2026-11-30");
    expect(f.getCell("D9").value).toBe("'=HYPERLINK(1)");
    expect(wb.getWorksheet("3. Contact Person (Updated)")!.getCell("B5").value).toBe("Fixture Person");
  });
});

describe("Tracker page uses the same lists", () => {
  const html = readFileSync("private/imds-tracker.html", "utf8");
  it("SENDERS equals TEAM", () => {
    const m = /const SENDERS=(\{[^}]*\});/.exec(html);
    expect(m && JSON.parse(m[1].replace(/(\w+):/g, '"$1":'))).toEqual(TEAM);
  });
  it("BUILTIN_BUYERS equals the server list", () => {
    const m = /const BUILTIN_BUYERS=(\{.*?\});\n/.exec(html);
    expect(m && JSON.parse(m[1])).toEqual(BUILTIN_BUYERS);
  });
  it("the default follow-up config has no Director CC and falls back to middle management", () => {
    expect(DEFAULT_CONFIG.ccRoles.dir).toBe(false);
    expect(DEFAULT_CONFIG.fallbackMid).toBe(true);
  });
});
