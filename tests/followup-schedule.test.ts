import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { BUILTIN_BUYERS, findEntry, resolveContacts, type Directory } from "@/lib/followup/directory";
import { classifyStatus, dateLong, maskProj, modelKey, renderSupplierEmail, TEAM } from "@/lib/followup/render";
import { describe as describeAuto, isDue, nextRuns, noticeFor, sanitizeAutomation, sanitizeAutomations, wibSlot } from "@/lib/followup/schedule";
import { DEFAULT_CONFIG, sanitizeConfig } from "@/lib/followup/center";
import { pickLibrary, sanitizeLibrary } from "@/lib/followup/library";
import { buildEmails, groupParts, noticeEmail, summaryRows, type Context, type MasterRow } from "@/lib/followup/scheduled-run";
import { buildSummaryPdf } from "@/lib/imds-master/summary-pdf";

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

describe("automations: frequency, days, hour (WIB), reminder", () => {
  const A = (o: Record<string, unknown>) => sanitizeAutomation({ enabled: true, days: [1], hour: 9, ...o });
  it("has no automation by default and turns an older single schedule into the first one", () => {
    expect(sanitizeConfig({}).automations).toEqual([]);
    const l = sanitizeAutomations(undefined, { enabled: true, days: [1, 4], hour: 8, attachments: { pdf: true, xlsx: false } });
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ id: "a1", enabled: true, days: [1, 4], hour: 8, frequency: "weekly", attachments: { pdf: true, xlsx: false, library: [] } });
  });
  it("keeps only valid values", () => {
    const a = sanitizeAutomation({ days: [1, 1, 9], hour: 25, maxSuppliers: 0, kind: "x", frequency: "daily", monthWeek: 9, notify: { leadHours: 500, to: "a@x.test; bad" }, skip: "nope" });
    expect(a).toMatchObject({ enabled: false, days: [1], hour: 9, maxSuppliers: 60, kind: "followup", frequency: "weekly", monthWeek: 1, notify: { enabled: true, leadHours: 24, to: ["a@x.test"] }, skip: "" });
  });
  it("uses WIB days and hours", () => {
    expect(wibSlot(new Date("2026-11-23T02:20:00Z"))).toMatchObject({ date: "2026-11-23", dow: 1, hour: 9, day: 23, key: "2026-11-23@09" });
    expect(wibSlot(new Date("2026-11-22T23:30:00Z")).dow).toBe(1);
  });
  it("weekly: due on the chosen days within the chosen hour, not on a skipped slot", () => {
    const a = A({ days: [1, 4] });
    expect(isDue(a, new Date("2026-11-23T02:59:00Z"))).toBe(true);
    expect(isDue(a, new Date("2026-11-23T03:00:00Z"))).toBe(false);
    expect(isDue(a, new Date("2026-11-24T02:10:00Z"))).toBe(false);
    expect(isDue({ ...a, enabled: false }, new Date("2026-11-23T02:10:00Z"))).toBe(false);
    expect(isDue({ ...a, skip: "2026-11-23@09" }, new Date("2026-11-23T02:10:00Z"))).toBe(false);
  });
  it("every 2 weeks: the anchor's week, then every other week", () => {
    const a = A({ frequency: "biweekly", anchor: "2026-11-23" });
    expect(nextRuns(a, new Date("2026-11-22T00:00:00Z"), 3).map((d) => wibSlot(d).date)).toEqual(["2026-11-23", "2026-12-07", "2026-12-21"]);
  });
  it("monthly: first / last week of the month", () => {
    expect(nextRuns(A({ frequency: "monthly", monthWeek: 1 }), new Date("2026-11-10T00:00:00Z"), 2).map((d) => wibSlot(d).date)).toEqual(["2026-12-07", "2027-01-04"]);
    expect(nextRuns(A({ frequency: "monthly", monthWeek: 5 }), new Date("2026-11-10T00:00:00Z"), 1).map((d) => wibSlot(d).date)).toEqual(["2026-11-30"]);
    expect(describeAuto(A({ frequency: "monthly", monthWeek: 5 }))).toBe("Monthly, last week, on Monday, 09:00–09:59 WIB");
  });
  it("sends the reminder `leadHours` before a run", () => {
    const a = A({ notify: { leadHours: 24 } });
    expect(noticeFor(a, new Date("2026-11-22T02:30:00Z"))?.toISOString()).toBe("2026-11-23T02:00:00.000Z");   // Sun 09:30 WIB → Mon 09:00
    expect(noticeFor(a, new Date("2026-11-22T03:30:00Z"))).toBeNull();
    expect(noticeFor({ ...a, notify: { ...a.notify, enabled: false } }, new Date("2026-11-22T02:30:00Z"))).toBeNull();
  });
  it("vercel.json registers one daily job per hour (Hobby plan allows daily jobs only)", () => {
    const v = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(v.crons).toHaveLength(24);
    expect(new Set(v.crons.map((c) => c.schedule.split(" ")[1]))).toEqual(new Set(Array.from({ length: 24 }, (_, h) => String(h))));
    for (const c of v.crons) { expect(c.path).toBe("/api/cron/followups"); expect(c.schedule).toMatch(/^\d+ \d+ \* \* \*$/); }
  });
});

describe("standard files (library)", () => {
  it("keeps allowed files byte for byte and attaches them in the chosen order", () => {
    const xlsx = Buffer.from("PK\u0003\u0004 fixture").toString("base64");
    const lib = sanitizeLibrary({ files: [
      { id: "f1", name: "IMDS_Supplier_Check_Form.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: xlsx },
      { id: "f2", name: "x.exe", contentType: "application/x-msdownload", base64: xlsx },
      { id: "f3", name: "guide.pdf", contentType: "application/pdf", base64: "JVBERi0=" }] });
    expect(lib.files.map((f) => f.id)).toEqual(["f1", "f3"]);
    expect(pickLibrary(lib, ["f3", "zz", "f1"]).map((f) => [f.name, f.contentBytes])).toEqual([["guide.pdf", "JVBERi0="], ["IMDS_Supplier_Check_Form.xlsx", xlsx]]);
  });
});

describe("automation e-mails", () => {
  const rows: MasterRow[] = [
    { id: "1", company_name: "ALPHA PARTS", vendor_code: "9001", project: "737D", part_no: "FX-1", part_name: "A (FIXTURE)", imds_status: "Not Submitted Yet", submission_plan: "2026-11-01" },
    { id: "2", company_name: "ALPHA PARTS", vendor_code: "9001", project: "737D", part_no: "FX-2", part_name: "B (FIXTURE)", imds_status: "Accepted" },
    { id: "3", company_name: "BETA COMPONENTS", vendor_code: "9002", project: "688D", part_no: "FX-3", part_name: "C (FIXTURE)", imds_status: "Rejected" },
    { id: "4", company_name: "GAMMA", vendor_code: "9003", project: "688D", part_no: "FX-4", part_name: "D (FIXTURE)", imds_status: "Working" }
  ];
  const ctx: Context = { cfg: sanitizeConfig({}), dir, due: { models: { "737D": "2026-11-25" }, suppliers: {} }, lib: sanitizeLibrary({ files: [{ id: "f1", name: "Form.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: "UEsDBA==" }] }), rows };
  const now = new Date("2026-11-23T02:00:00Z");
  it("groups outstanding parts per supplier (Working only when asked) and counts the summary over all parts", () => {
    const a = sanitizeAutomation({});
    expect(groupParts(a, rows, "2026-11-23").map((g) => [g.name, g.parts.length])).toEqual([["ALPHA PARTS", 1], ["BETA COMPONENTS", 1]]);
    expect(groupParts({ ...a, includeWorking: true }, rows, "2026-11-23").map((g) => g.name)).toContain("GAMMA");
    expect(groupParts({ ...a, models: ["688D"] }, rows, "2026-11-23").map((g) => g.name)).toEqual(["BETA COMPONENTS"]);
    expect(groupParts({ ...a, onlyPastDue: true }, rows, "2026-11-23").map((g) => g.name)).toEqual(["ALPHA PARTS"]);
    expect(summaryRows(groupParts(a, rows, "2026-11-23"), rows, a, ctx.due)[0]).toMatchObject({ supplier: "ALPHA PARTS", total: 2, submitted: 1, missing: 1, due: "2026-11-25" });
  });
  it("per supplier: recipients from the Directory, middle management when there is no PIC, the chosen files", async () => {
    const b = await buildEmails(ctx, sanitizeAutomation({ attachments: { pdf: false, xlsx: true, library: ["f1"] }, sender: "Werner" }), { now });
    expect(b.out.map((x) => [x.plan.supplier, x.plan.to.join(";"), x.plan.toFrom])).toEqual([["ALPHA PARTS", "pic@alpha.test;to2@alpha.test", "pic"], ["BETA COMPONENTS", "dph@beta.test;gm@beta.test", "mid"]]);
    expect(b.out[0].plan.cc).toContain("cc@alpha.test");
    expect(b.out[0].plan.attachments).toEqual(["IMDS_Outstanding_9001_2026-11-23.xlsx", "Form.xlsx"]);
    const files = await b.out[0].files();
    expect(files.map((f) => f.name)).toEqual(["IMDS_Outstanding_9001_2026-11-23.xlsx", "Form.xlsx"]);
    expect(files[1].contentBytes).toBe("UEsDBA==");
    expect(b.out[0].plan.body).toContain("Abdullah Luthfi Werner");
  });
  it("summary: one e-mail to every supplier's PIC with the summary PDF", async () => {
    const b = await buildEmails(ctx, sanitizeAutomation({ kind: "recap", attachments: { pdf: true, xlsx: false, library: [] } }), { now });
    expect(b.out).toHaveLength(1);
    expect(b.out[0].plan.to).toEqual(["pic@alpha.test", "to2@alpha.test", "dph@beta.test", "gm@beta.test"]);
    const files = await b.out[0].files();
    expect(files[0].name).toBe("IMDS_Submission_Summary_2026-11-23.pdf");
    expect(Buffer.from(files[0].contentBytes, "base64").subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
  it("the reminder says what goes out, when, and where to stop it", () => {
    const a = sanitizeAutomation({ name: "Weekly 737D", enabled: true, days: [1], hour: 9 });
    const m = noticeEmail(a, { automationId: a.id, name: a.name, slot: "2026-11-23@09", dryRun: true, sent: 0, failed: 0, skipped: 1, from: "IMDS", planned: [
      { supplier: "ALPHA PARTS", code: "9001", parts: 2, to: ["pic@alpha.test"], cc: ["x@y.test"], toFrom: "pic", subject: "s", attachments: ["Form.xlsx"] },
      { supplier: "GAMMA", code: "9003", parts: 1, to: [], cc: [], toFrom: "none", subject: "s", attachments: [], skip: "No e-mail address" }] }, now, "https://app.test");
    expect(m.subject).toBe('[IMDS automation] "Weekly 737D" will send 1 e-mail(s) on Monday, 23 November 2026 at 09:00 WIB');
    expect(m.body).toContain("1. ALPHA PARTS — 2 part(s) — To: pic@alpha.test — CC: 1 — Files: Form.xlsx");
    expect(m.body).toContain("- GAMMA: No e-mail address");
    expect(m.body).toContain("https://app.test/imds-tracker#followup");
  });
  it("summary PDF is a valid PDF", async () => {
    const pdf = await buildSummaryPdf({ title: "IMDS Submission Summary", subtitle: "FIXTURE", models: ["7*7D"], generatedAt: now, rows: Array.from({ length: 45 }, (_, i) => ({ supplier: "SUPPLIER " + i + " (FIXTURE)", code: String(9000 + i), total: 10, submitted: i % 10, missing: 10 - (i % 10), rejected: 0, working: 0, due: "2026-11-30" })) });
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1500);
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
    expect(DEFAULT_CONFIG.automations).toEqual([]);
  });
});
