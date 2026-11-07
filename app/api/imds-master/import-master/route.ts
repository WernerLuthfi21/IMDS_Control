import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { getAuthContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Plain = string | number | boolean | null;

function plain(value: unknown): Plain {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("result" in v) return plain(v.result);
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((x) => x && typeof x === "object" && "text" in x ? String((x as { text: unknown }).text) : "").join("");
    }
    if ("hyperlink" in v) return String(v.text || v.hyperlink);
    return JSON.stringify(value);
  }
  return String(value);
}

function text(value: unknown): string {
  const v = plain(value);
  return v === null ? "" : String(v).replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

function normHeader(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function dateISO(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const v = plain(value);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const s = v.trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = /^(\d{1,2})[\/. -](\d{1,2})[\/. -](\d{4})$/.exec(s);
    if (m) {
      const month = Number(m[1]), day = Number(m[2]), year = Number(m[3]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }
  return null;
}

function normalizePartNo(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function findHeader(headers: string[], aliases: string[]) {
  const wanted = new Set(aliases.map(normHeader));
  const index = headers.findIndex((header) => wanted.has(normHeader(header)));
  return index < 0 ? 0 : index + 1;
}

function findHeaderExcluding(headers: string[], aliases: string[], excludedColumn: number) {
  const wanted = new Set(aliases.map(normHeader));
  const index = headers.findIndex((header, i) => i + 1 !== excludedColumn && wanted.has(normHeader(header)));
  return index < 0 ? 0 : index + 1;
}

export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth.configured) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!auth.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "preparer"].includes(auth.role || "")) {
    return NextResponse.json({ error: "Admin or preparer role is required to import the master workbook." }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an .xlsx master workbook first." }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Only .xlsx workbooks are supported." }, { status: 415 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "File exceeds the 20 MB upload limit." }, { status: 413 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(buffer).digest("hex");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

    let sheet = workbook.getWorksheet("Part List LATEST");
    if (!sheet) {
      sheet = workbook.worksheets.find((ws) => {
        for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
          const row = ws.getRow(r);
          const hs = Array.from({ length: Math.min(row.cellCount, 100) }, (_, i) => normHeader(row.getCell(i + 1).value));
          if (hs.includes("companyname") && hs.some((h) => h === "pno" || h === "partno")) return true;
        }
        return false;
      });
    }
    if (!sheet) return NextResponse.json({ error: "Could not find a 'Part List LATEST' sheet or a compatible Company Name / P-No header row." }, { status: 422 });

    let headerRow = sheet.name === "Part List LATEST" ? 6 : 0;
    const scoreRow = (r: number) => {
      const row = sheet!.getRow(r);
      const hs = Array.from({ length: Math.min(row.cellCount, 100) }, (_, i) => normHeader(row.getCell(i + 1).value));
      return Number(hs.includes("project")) + Number(hs.includes("companyname")) + Number(hs.includes("pno") || hs.includes("partno")) + Number(hs.includes("imdsstatus"));
    };
    if (!headerRow || scoreRow(headerRow) < 3) {
      let bestScore = 0;
      for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
        const score = scoreRow(r);
        if (score > bestScore) { bestScore = score; headerRow = r; }
      }
    }
    if (!headerRow || scoreRow(headerRow) < 3) return NextResponse.json({ error: "Could not identify the master header row." }, { status: 422 });

    const headers = Array.from({ length: Math.min(sheet.columnCount, 200) }, (_, i) => text(sheet!.getRow(headerRow).getCell(i + 1).value));
    const imdsIdVersionColumn = findHeader(headers, ["ID / Ver", "ID/Ver", "ID / Version"]);
    const cols = {
      project: findHeader(headers, ["PROJECT", "Project / Model", "Model"]),
      vendor_code: findHeader(headers, ["VENDOR CODE", "Vendor Code"]),
      main_pic_email: findHeader(headers, ["MAIN PIC EMAIL", "PIC Email", "Email PIC"]),
      company_name: findHeader(headers, ["COMPANY NAME", "Company Name", "Supplier Name"]),
      part_name: findHeader(headers, ["PART NAME", "Part Name", "Description"]),
      part_no: findHeader(headers, ["P/No.", "P/No", "Part No", "Part Number"]),
      submission_plan: findHeader(headers, ["SUBMISSION PLAN", "Submission Plan", "Target Date"]),
      supplier_promise_date: findHeader(headers, ["Supplier Promise Date", "Supplier Promise"]),
      imds_status: findHeader(headers, ["IMDS STATUS", "IMDS Status"]),
      imds_id_version: imdsIdVersionColumn,
      part_status: findHeader(headers, ["Part Status"]),
      have_respond_email: findHeader(headers, ["Have respond email", "Have Respond Email"]),
      status_update: findHeader(headers, ["STATUS UPDATE", "Status Update"]),
      md_id_version: findHeaderExcluding(headers, ["MD ID/Ver", "MD ID / Ver", "ID/Ver", "ID / Ver"], imdsIdVersionColumn),
      md_status_update_date: findHeader(headers, ["Date", "Status Update Date"]),
      comment: findHeader(headers, ["Comment", "Remark", "Notes"]),
      lpop_confirmation: findHeader(headers, ["LPOP Confirmation"]),
      cek: findHeader(headers, ["CEK"])
    };
    const missing = ["company_name", "part_no"].filter((key) => !cols[key as keyof typeof cols]);
    if (missing.length) return NextResponse.json({ error: `Required master columns are missing: ${missing.join(", ")}.` }, { status: 422 });

    const mappedColumns = new Set(Object.values(cols).filter(Boolean));
    const occurrences = new Map<string, number>();
    const rows: Record<string, unknown>[] = [];
    const maxRow = Math.min(sheet.rowCount, headerRow + 100000);
    let skipped = 0;

    for (let r = headerRow + 1; r <= maxRow; r++) {
      const row = sheet.getRow(r);
      if (!Array.from({ length: Math.min(row.cellCount, 200) }, (_, i) => plain(row.getCell(i + 1).value)).some((v) => v !== null && v !== "")) continue;
      const get = (column: number) => column ? row.getCell(column).value : null;
      const project = text(get(cols.project));
      const vendorCode = text(get(cols.vendor_code));
      const company = text(get(cols.company_name));
      const partNo = text(get(cols.part_no));
      if (!partNo) { skipped++; continue; }

      const base = [project, vendorCode, company, normalizePartNo(partNo)].map((v) => v.toUpperCase().trim()).join("|");
      const occurrence = occurrences.get(base) || 0;
      occurrences.set(base, occurrence + 1);
      const masterKey = sha(`${base}|duplicate:${occurrence}`);

      const extra: Record<string, unknown> = {};
      for (let c = 1; c <= headers.length; c++) {
        if (mappedColumns.has(c)) continue;
        const header = headers[c - 1] || `Column ${c}`;
        const key = `${header} [col ${c}]`;
        const value = plain(row.getCell(c).value);
        if (value !== null && value !== "") extra[key] = value;
      }

      rows.push({
        master_key: masterKey,
        project: project || null,
        vendor_code: vendorCode || null,
        main_pic_email: text(get(cols.main_pic_email)) || null,
        company_name: company || null,
        part_name: text(get(cols.part_name)) || null,
        part_no: partNo,
        part_no_norm: normalizePartNo(partNo),
        submission_plan: dateISO(get(cols.submission_plan)),
        supplier_promise_date: dateISO(get(cols.supplier_promise_date)),
        imds_status: text(get(cols.imds_status)) || null,
        imds_id_version: text(get(cols.imds_id_version)) || null,
        part_status: text(get(cols.part_status)) || null,
        have_respond_email: text(get(cols.have_respond_email)) || null,
        status_update: text(get(cols.status_update)) || null,
        md_id_version: text(get(cols.md_id_version)) || null,
        md_status_update_date: dateISO(get(cols.md_status_update_date)),
        comment: text(get(cols.comment)) || null,
        lpop_confirmation: text(get(cols.lpop_confirmation)) || null,
        cek: text(get(cols.cek)) || null,
        extra_fields: extra,
        source_file_name: file.name,
        source_file_hash: fileHash,
        source_sheet: sheet.name,
        source_row: r,
        last_imported_at: new Date().toISOString(),
        updated_by: auth.userId
      });
    }

    if (!rows.length) return NextResponse.json({ error: "No usable part rows found. Check the P/No. column and header mapping." }, { status: 422 });

    const keys = rows.map((row) => String(row.master_key));
    const existing = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < keys.length; i += 300) {
      const chunk = keys.slice(i, i + 300);
      const { data, error } = await supabase.from("imds_master_parts").select("*").in("master_key", chunk);
      if (error) return NextResponse.json({ error: `Could not compare against the current master: ${error.message}` }, { status: 500 });
      for (const item of data || []) existing.set(String(item.master_key), item as Record<string, unknown>);
    }

    const toUpsert = rows.map((row) => {
      const prior = existing.get(String(row.master_key));
      if (!prior) return { ...row, manual_overrides: [], md_system_records: [] as unknown[] };
      const overrides = Array.isArray(prior.manual_overrides) ? prior.manual_overrides as string[] : [];
      const mdRecords = Array.isArray(prior.md_system_records) ? prior.md_system_records : [];
      const merged = { ...row, manual_overrides: overrides, md_system_records: mdRecords, md_system_updated_at: prior.md_system_updated_at || null };
      // Formula-derived MD columns can be blank or #N/A in a workbook that has not recalculated yet.
      // Keep the last imported MD System value until a newer MD System search result replaces it.
      if (mdRecords.length) {
        for (const field of ["status_update", "md_id_version", "md_status_update_date", "comment"]) {
          const incoming = (merged as Record<string, unknown>)[field];
          const isBlankOrError = incoming === null || incoming === undefined || String(incoming).trim() === "" || /^#(N\/A|VALUE!|REF!|NAME\?)/i.test(String(incoming));
          if (isBlankOrError && prior[field] !== null && prior[field] !== undefined) {
            (merged as Record<string, unknown>)[field] = prior[field];
          }
        }
      }
      for (const field of overrides) {
        if (field in prior) (merged as Record<string, unknown>)[field] = prior[field];
      }
      return merged;
    });

    for (let i = 0; i < toUpsert.length; i += 250) {
      const { error } = await supabase.from("imds_master_parts").upsert(toUpsert.slice(i, i + 250), { onConflict: "master_key" });
      if (error) return NextResponse.json({ error: `Master data upsert failed after processing ${i} rows: ${error.message}` }, { status: 500 });
    }

    let contactsImported = 0;
    const contactSheet = workbook.getWorksheet("Contact NOT SUBMITTED YET");
    if (contactSheet) {
      const contactsByKey = new Map<string, Record<string, unknown>>();
      const roleColumns = [
        { column: 4, role: "PIC", priority: 3 },
        { column: 6, role: "MARKETING_CC", priority: 2 },
        { column: 7, role: "MARKETING_SPV", priority: 1 }
      ];
      for (let r = 4; r <= Math.min(contactSheet.rowCount, 20000); r++) {
        const contactRow = contactSheet.getRow(r);
        const supplierCode = text(contactRow.getCell(2).value);
        const supplierName = text(contactRow.getCell(3).value);
        if (!supplierCode || !supplierName) continue;
        for (const role of roleColumns) {
          const rawEmails = text(contactRow.getCell(role.column).value);
          if (!rawEmails || rawEmails === "0") continue;
          const emails = rawEmails.split(/[;,\\n]+/).map((email) => email.trim().replace(/^<|>$/g, "").toLowerCase()).filter((email) => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email));
          for (const email of emails) {
            const key = supplierCode.toUpperCase() + "|" + email;
            const prior = contactsByKey.get(key);
            if (!prior || Number(prior.priority) < role.priority) {
              contactsByKey.set(key, {
                supplier_code: supplierCode,
                supplier_name: supplierName,
                email,
                contact_role: role.role,
                active: true,
                created_by: auth.userId,
                priority: role.priority
              });
            }
          }
        }
      }
      const contacts = [...contactsByKey.values()].map(({ priority: _priority, ...contact }) => contact);
      for (let i = 0; i < contacts.length; i += 250) {
        const { error: contactError } = await supabase.from("supplier_contacts").upsert(contacts.slice(i, i + 250), { onConflict: "supplier_code,email" });
        if (contactError) return NextResponse.json({ error: `Master data was imported, but supplier contact sync failed: ${contactError.message}` }, { status: 500 });
      }
      contactsImported = contacts.length;
    }

    const inserted = rows.filter((row) => !existing.has(String(row.master_key))).length;
    const updated = rows.length - inserted;
    const { data: batch, error: batchError } = await supabase.from("imds_master_import_batches").insert({
      file_name: file.name,
      source_file_hash: fileHash,
      source_sheet: sheet.name,
      total_rows: rows.length,
      inserted_rows: inserted,
      updated_rows: updated,
      skipped_rows: skipped,
      uploaded_by: auth.userId,
      metadata: { headerRow, headerCount: headers.length, mappedColumns: cols, contactsImported }
    }).select("id").single();
    if (batchError) return NextResponse.json({ error: `Master rows were saved, but import history could not be recorded: ${batchError.message}` }, { status: 500 });

    await supabase.from("audit_events").insert({
      actor_id: auth.userId,
      action: "IMDS_MASTER_WORKBOOK_IMPORTED",
      entity_type: "imds_master_import_batch",
      entity_id: batch.id,
      metadata: { fileName: file.name, rows: rows.length, inserted, updated, skipped, contactsImported, sheet: sheet.name }
    });

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      fileName: file.name,
      sheetName: sheet.name,
      headerRow,
      totalRows: rows.length,
      inserted,
      updated,
      skipped,
      contactsImported,
      note: "Rows missing from a later upload are retained. Existing manual edits and MD System matches are preserved."
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("IMDS master import failed.", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Master workbook import failed." }, { status: 422 });
  }
}
