import type { MasterSnapshot } from "./use-shared-master";
import type { TrackerDueDates } from "@/lib/tracker/shared-master";

const parts = [
  ["SYNTH-01", "Fixture Gears", "FIX-101", "Gear housing", "Submission complete", "2024-02-01"],
  ["SYNTH-01", "Fixture Gears", "FIX-102", "Mounting plate", "Under judgement", "2024-02-01"],
  ["SYNTH-01", "Fixture Seals", "FIX-201", "Seal cover", "Not submitted yet", "2024-02-01"],
  ["SYNTH-01", "Fixture Seals", "fix-201", "", "Rejected", "2024-01-15"],
  ["SYNTH-01", "Fixture Seals", "FIX-203", "Seal retainer", "CHECK", "2024-02-01"],
  ["SYNTH-02", "Fixture Fasteners", "FIX-301", "Bolt flange", "Accepted", "2024-02-01"],
  ["SYNTH-02", "Fixture Fasteners", "FIX-302", "Bolt sleeve", "Missing", ""],
  ["SYNTH-02", "Fixture Gears", "FIX-303", "Clamp", "STOP RUN", ""],
  ["SYNTH-03", "Fixture Gears", "FIX-304", "Spacer ring", "Accepted", ""],
  ["SYNTH-03", "Fixture Gears", "FIX-305", "Button washer", "Accepted", ""]
];

const snapshot: MasterSnapshot = {
  rows: parts.map(([project, company, partNo, partName, status, plan], index) => ({
    id: `fixture-${index + 1}`,
    project,
    company_name: company,
    vendor_code: company.toUpperCase().replace(" ", "-"),
    part_no: partNo,
    part_name: partName,
    imds_status: status,
    submission_plan: plan
  })),
  contacts: [],
  refreshedAt: "2026-11-26T10:00:00.000Z"
};
const dueDates: TrackerDueDates = { version: 1, models: { "SYNTH-01": "2024-02-01", "SYNTH-02": "2090-12-15" }, suppliers: {} };

export const trackerFixture = { snapshot, dueDates };
