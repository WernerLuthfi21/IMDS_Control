import { describe, expect, it } from "vitest";
import { toPartMasterExcelRow } from "@/lib/imds-master/outbox";

const HEADERS = ["NO.", "PROJECT", "VENDOR CODE", "MAIN PIC EMAIL", "COMPANY NAME", "PART NAME", "PART NO.", "SUBMISSION PLAN", "PART STATUS", "ID / VER", "STATUS DATE", "COMMENT", "KEY"];

describe("master sheet row", () => {
  const row = toPartMasterExcelRow({ master_key: "k1", project: "688D", vendor_code: "0003", company_name: "ACME", part_no: "P1", submission_plan: "2026-12-01", imds_status: null, imds_id_version: null, md_id_version: "1525320002 / 2", md_status_update_date: "2026-11-01", comment: "", md_system_records: [{ status: "accepted", idVersion: "1525320002 / 2", lastStatusChanged: "2026-11-01" }], extra_fields: { "LPOP Confirmation [col 17]": "x" } });
  it("has exactly the agreed ALL-CAPS columns, no duplicates and no legacy extras", () => {
    expect(Object.keys(row)).toEqual(HEADERS);
    for (const h of Object.keys(row)) expect(h).toBe(h.toUpperCase());
  });
  it("has one status, derived from MD System when the master has none yet", () => {
    expect(row["PART STATUS"]).toBe("ACCEPTED");
    expect(row["ID / VER"]).toBe("1525320002 / 2");
    expect(row["STATUS DATE"]).toBe("2026-11-01");
    expect(row.KEY).toBe("k1");
  });
});
