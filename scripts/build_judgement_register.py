"""Fill the Power Automate master table (JudgementRegister) from the G-CATS Error Log sheet of
Master Data All IMDS. Keeps every value already in the register (the website/flow wrote those),
adds every code from the log, derives the code for rows where the log left it empty
(Download Date YYYYMMDD + No. padded to 3, the rule all 4,841 filled codes follow) and marks it."""
import sys, re, datetime, collections, json
import openpyxl
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import PatternFill, Font, Alignment

reg_path, master_path, out_path, report_path = sys.argv[1:5]
wbm = openpyxl.load_workbook(master_path, read_only=True, data_only=True)
log = wbm["G-CATS Error Log Master Data"]
hdr = list(next(log.iter_rows(min_row=4, max_row=4, values_only=True)))
COL = dict(code=0, year=1, month=2, no=3, download=4, company=7, supplier=9, part=10, status=13, etype=14, lastcomment=15,
           assigned=40, start=41, proc=42, judge=43, okc=44, rej=45, km=46, kmc=47, change=48)
assert hdr[COL["etype"]] == "Error Type" and hdr[COL["assigned"]] == "Assigned person" and str(hdr[COL["judge"]]).startswith("Judge"), "column layout changed"

def s(v):
    if v is None: return ""
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return str(v).replace(" ", " ").strip()
def as_date(v):
    if isinstance(v, datetime.datetime): return v.date()
    if isinstance(v, datetime.date): return v
    t = s(v)
    m = re.match(r"^(\d{4})[/-](\d{1,2})[/-](\d{1,2})", t)
    if m: return datetime.date(int(m[1]), int(m[2]), int(m[3]))
    return None
def judge_of(v):
    t = s(v).upper()
    return t if t in ("OK", "NG") else ""

rows, derived, skipped = [], 0, []
for n, r in enumerate(log.iter_rows(min_row=5, values_only=True), start=5):
    if not any(s(x) for x in r[1:20]): continue
    code = s(r[COL["code"]]); origin = "G-CATS log"
    if not code:
        d = as_date(r[COL["download"]]); no = s(r[COL["no"]])
        if d and no.isdigit():
            code = d.strftime("%Y%m%d") + no.zfill(3); origin = "Derived: Download Date + No."; derived += 1
        else:
            skipped.append({"row": n, "why": "no code, no Download Date / No."}); continue
    rows.append(dict(src_row=n, code="code:" + code, origin=origin, r=r))

by = collections.OrderedDict()
dupes = []
for x in rows:
    if x["code"] in by: dupes.append(x["code"]); continue
    by[x["code"]] = x

wb = openpyxl.load_workbook(reg_path)
ws = wb["JudgementRegister"]
base = [c.value for c in ws[1]][:13]
assert base[0] == "code" and base[7] == "Judge OK/NG", "register header changed"
existing = {}
for row in ws.iter_rows(min_row=2, values_only=True):
    k = s(row[0])
    if k and not k.startswith("EXAMPLE"): existing[k] = list(row[:13])

EXTRA = ["Supplier reminder", "Last reminder sent", "Reminder count", "Judgement state", "G-CATS status", "Source judge label", "Comment (last time)", "Company Name", "Year", "Download Date", "Code origin", "Source row"]
HEAD = base + EXTRA
out_rows, conflicts = [], []
# Error types whose Manual Flow first step is "Confirm to supplier" (WARP goes to Purchasing, ELV Pb to TMC/date rules).
SUPPLIER_TYPES = re.compile(r"mass tolerance|sms mass|application ?44|prohibited|not specified|mass deviation|supplied is not sms", re.I)
def pile(judge, km, status):
    if judge: return "Judged" if km else "Waiting TMA"
    return "To judge" if status.upper() == "WORKING" else "Other"

for code, x in by.items():
    r = x["r"]
    src = [code, s(r[COL["etype"]]), s(r[COL["part"]]), s(r[COL["supplier"]]), s(r[COL["assigned"]]), as_date(r[COL["start"]]),
           s(r[COL["proc"]]), judge_of(r[COL["judge"]]), s(r[COL["okc"]]), s(r[COL["rej"]]), judge_of(r[COL["km"]]), s(r[COL["kmc"]]),
           (as_date(r[COL["change"]]).isoformat() if as_date(r[COL["change"]]) else s(r[COL["change"]]))]
    if code in existing:
        cur = existing.pop(code)
        merged = []
        for i, (a, b) in enumerate(zip(cur, src)):
            a_s = a if isinstance(a, (datetime.date, datetime.datetime)) else s(a)
            if a_s not in ("", None):
                merged.append(a)
                bb = b.isoformat() if isinstance(b, datetime.date) else b
                aa = a.date().isoformat() if isinstance(a, datetime.datetime) else (a.isoformat() if isinstance(a, datetime.date) else s(a))
                if bb and aa != bb and i not in (12,): conflicts.append({"code": code, "column": base[i], "register (kept)": aa, "master": bb})
            else: merged.append(b)
        src = merged
    raw_j = s(r[COL["judge"]]); raw_k = s(r[COL["km"]])
    label = "; ".join(x for x in [("Judge: " + raw_j) if raw_j and raw_j.upper() not in ("OK", "NG") else "", ("KM: " + raw_k) if raw_k and raw_k.upper() not in ("OK", "NG") else ""] if x)
    status = s(r[COL["status"]])
    src_d = as_date(r[COL["download"]])
    state = pile(s(src[7]), s(src[10]), status)
    extra = ["Y" if state == "To judge" and SUPPLIER_TYPES.search(s(src[1])) else "", None, 0, state, status, label, s(r[COL["lastcomment"]]), s(r[COL["company"]]), (int(s(r[COL["year"]])) if s(r[COL["year"]]).isdigit() else None),
             src_d, x["origin"], x["src_row"]]
    out_rows.append(src + extra)
# register rows not in the log stay (never deleted)
for code, cur in existing.items():
    out_rows.append(cur + ["", None, 0, "", "", "", "", "", None, None, "Register only (not in this log)", None])

out_rows.sort(key=lambda v: v[0], reverse=True)
# rewrite sheet
ws.delete_rows(1, ws.max_row)
for name in list(ws.tables.keys()): del ws.tables[name]
ws.append(HEAD)
for v in out_rows: ws.append(v)
last = ws.max_row
ref = f"A1:{openpyxl.utils.get_column_letter(len(HEAD))}{last}"
# Judgement state is a calculated column, so it follows every judgement the website or a person writes.
R = lambda c: f"JudgementRegister[[#This Row],[{c}]]"
STATE_F = f'=IF({R("Judge OK/NG")}<>"",IF({R("KM Judge")}<>"","Judged","Waiting TMA"),IF(UPPER(TRIM({R("G-CATS status")}))="WORKING","To judge","Other"))'
for rr in range(2, last + 1):
    if ws.cell(rr, 17).value: ws.cell(rr, 17).value = STATE_F
t = Table(displayName="JudgementRegister", ref=ref)
t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
t._initialise_columns()
for tc in t.tableColumns:
    if tc.name == "Judgement state":
        from openpyxl.worksheet.table import TableFormula
        tc.calculatedColumnFormula = TableFormula(attr_text=STATE_F[1:])
ws.add_table(t)
wb.calculation.fullCalcOnLoad = True
widths = [22, 28, 16, 12, 18, 13, 60, 11, 40, 34, 10, 30, 26, 11, 19, 10, 15, 14, 24, 40, 34, 7, 13, 30, 9]
for i, w in enumerate(widths, start=1): ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
for row in ws.iter_rows(min_row=2, max_row=last):
    row[3].number_format = "@"; row[2].number_format = "@"; row[12].number_format = "@"; row[14].number_format = "@"
    row[5].number_format = "yyyy-mm-dd"; row[22].number_format = "yyyy-mm-dd"
    row[6].alignment = Alignment(wrap_text=False, vertical="top")
ws.freeze_panes = "C2"
dvr = DataValidation(type="list", formula1='"Y,N"', allow_blank=True); dvr.add(f"N2:N{last}"); ws.add_data_validation(dvr)
for col in ("H", "K"):
    dv = DataValidation(type="list", formula1='"OK,NG"', allow_blank=True, showErrorMessage=True, errorTitle="OK or NG", error="Judge is OK, NG or empty.")
    dv.add(f"{col}2:{col}{last}"); ws.add_data_validation(dv)
fills = {"To judge": "F5E9CC", "Waiting TMA": "E0E8EF", "Judged": "E2ECDF", "Other": "EEEEEE"}
for k, color in fills.items():
    ws.conditional_formatting.add(f"Q2:Q{last}", FormulaRule(formula=[f'$Q2="{k}"'], fill=PatternFill("solid", fgColor=color), font=Font(bold=k == "To judge")))
# Summary sheet with live formulas (follows the table as the flow updates it)
sm = wb.create_sheet("Summary", 0) if "Summary" not in wb.sheetnames else wb["Summary"]
sm["A1"] = "Judgement Register: summary"; sm["A1"].font = Font(bold=True, size=14)
sm["A2"] = "Counts follow the JudgementRegister table automatically. Judgement state: To judge = WORKING without Judge; Waiting TMA = Judge set, KM empty; Judged = Judge and KM set; Other = not WORKING and not judged."
sm["A2"].alignment = Alignment(wrap_text=True); sm.row_dimensions[2].height = 45
sm["A4"], sm["B4"] = "Judgement state", "Rows"; sm["A4"].font = sm["B4"].font = Font(bold=True)
for i, k in enumerate(["To judge", "Waiting TMA", "Judged", "Other"], start=5):
    sm[f"A{i}"] = k; sm[f"B{i}"] = f'=COUNTIF(JudgementRegister[Judgement state],"{k}")'
    sm[f"A{i}"].fill = PatternFill("solid", fgColor=fills[k])
sm["A9"] = "Total"; sm["B9"] = "=ROWS(JudgementRegister[code])"; sm["A9"].font = Font(bold=True)
sm["A11"] = "Codes derived (log had no code)"; sm["B11"] = '=COUNTIF(JudgementRegister[Code origin],"Derived*")'
sm["A12"] = "Non-OK/NG labels in the log (Δ, #REF!, …)"; sm["B12"] = '=COUNTIF(JudgementRegister[Source judge label],"?*")'
sm["A15"] = "To judge by Error Type"; sm["A15"].font = Font(bold=True)
types = collections.Counter(v[1] for v in out_rows if v[16] == "To judge")
for i, (t_, n) in enumerate(types.most_common(), start=16):
    sm[f"A{i}"] = t_; sm[f"B{i}"] = f'=COUNTIFS(JudgementRegister[Error Type],A{i},JudgementRegister[Judgement state],"To judge")'
sm.column_dimensions["A"].width = 46; sm.column_dimensions["B"].width = 12
# SupplierContacts: the reminder flow looks up the PIC here (standard Excel connector, no database).
sc = wb.create_sheet("SupplierContacts")
sc.append(["Supplier Code", "Supplier Name", "PIC Email", "CC Emails", "Send reminders", "Language", "Notes"])
need = collections.OrderedDict()
for v in out_rows:
    if v[13] == "Y" and s(v[3]) and s(v[3]) not in need: need[s(v[3])] = s(v[20])
for code, name in sorted(need.items()): sc.append([code, name, "", "", "Y", "EN", ""])
sc.add_table(Table(displayName="SupplierContacts", ref=f"A1:G{max(2, sc.max_row)}", tableStyleInfo=TableStyleInfo(name="TableStyleMedium4", showRowStripes=True)))
for col, w in zip("ABCDEFG", [14, 40, 34, 44, 15, 10, 30]): sc.column_dimensions[col].width = w
for row in sc.iter_rows(min_row=2): row[0].number_format = "@"
dvs = DataValidation(type="list", formula1='"Y,N"', allow_blank=True); dvs.add(f"E2:E{max(2, sc.max_row)}"); sc.add_data_validation(dvs)
sm["A13"] = "Rows marked for supplier reminder"; sm["B13"] = '=COUNTIF(JudgementRegister[Supplier reminder],"Y")'
wb.active = wb.sheetnames.index("JudgementRegister")
wb.save(out_path)

counts = collections.Counter(v[16] for v in out_rows)
json.dump({"rows": len(out_rows), "fromLog": len(by), "derivedCodes": derived, "skipped": skipped, "duplicateCodesInLog": dupes,
           "registerOnlyKept": len(existing), "conflicts": conflicts, "states": counts,
           "nonOkNgLabels": sum(1 for v in out_rows if v[18]), "reminderY": sum(1 for v in out_rows if v[13] == "Y"), "toJudgeByType": types.most_common()}, open(report_path, "w"), default=str, indent=1)
print(json.dumps({"rows": len(out_rows), "derived": derived, "skipped": len(skipped), "dupes": len(dupes), "conflicts": len(conflicts), "states": counts}, default=str))
