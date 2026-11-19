"""Build JudgementRegister.xlsx: the Power Automate master table that mirrors the G-CATS Error Log of
"Master Data All IMDS" and the newest daily G-CATS TMMIN exports, plus our judgement for every row.

    python scripts/build_judgement_register.py MASTER.xlsx OUT.xlsx REPORT.json [--register CURRENT_REGISTER.xlsx] [GCATS_DAILY.xlsx ...]

Rules (Werner, 2026-11-19):
- Same rows and order as the master's "G-CATS Error Log Master Data" sheet: oldest first, the newest download at the
  BOTTOM. A daily G-CATS export can list the newest day at the top; it is re-ordered by Download Date + No.
- `code` = TMA's code when present, else Download Date (YYYYMMDD) + No. padded to 3 (the rule every filled code
  follows). Plain code, no "code:" prefix (the website sends the same plain code).
- Source fields come from the newest file that has the row. Judgement fields (Assigned person … Last Change Date)
  keep a value already in the current register (written by the website through Power Automate), else the master's.
- Nothing is deleted. Rows only in the current register are kept at the end.
- Sheets: JudgementRegister (the table the flows write to), Search, For TMA (judged by us, waiting for TMA),
  Summary, SupplierContacts (reminder flow), Read me. Font: Century Gothic.
"""
import sys, re, datetime, collections, json
import openpyxl
from openpyxl.worksheet.table import Table, TableStyleInfo, TableFormula
from openpyxl.worksheet.formula import ArrayFormula
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter as L

args = sys.argv[1:]
register_path = None
if "--register" in args:
    i = args.index("--register"); register_path = args[i + 1]; del args[i:i + 2]
master_path, out_path, report_path, *daily_paths = args

FONT = "Century Gothic"
def s(v):
    if v is None: return ""
    if isinstance(v, float) and v.is_integer(): v = int(v)
    t = str(v).replace(" ", " ").replace("_x000D_", " ").strip()
    return "" if t in ("***",) or re.match(r"^#(N/A|VALUE!|REF!|DIV/0!|NAME\?)", t) else t
def as_date(v):
    if isinstance(v, datetime.datetime): return v.date()
    if isinstance(v, datetime.date): return v
    m = re.match(r"^(\d{4})[/-](\d{1,2})[/-](\d{1,2})", s(v))
    return datetime.date(int(m[1]), int(m[2]), int(m[3])) if m else None
def judge_of(v):
    t = s(v).upper()
    return t if t in ("OK", "NG") else ""
def num(v):
    t = s(v).replace(",", ".")
    try: return float(t) if "." in t else int(t)
    except ValueError: return s(v)
hnorm = lambda h: re.sub(r"\s+", " ", str(h or "")).strip().lower()

# One field list for every source. (register header, source header(s), kind)
SOURCE = [
    ("Year", ["year"], "int"), ("Month", ["month"], "text"), ("No.", ["no."], "int"), ("Download Date", ["download date"], "date"),
    ("G-CATS Status", ["status"], "text"), ("Error Type", ["error type"], "text"), ("Company Name", ["company name"], "text"),
    ("Supplier Code", ["supplier code"], "code"), ("Delivery Part No", ["delivery part no"], "text"), ("Delivery Part Name", ["delivery part name"], "text"),
    ("ELV Part", ["elv part"], "text"), ("Module ID", ["module id"], "code"), ("Version", ["version"], "text"), ("Comment(last time)", ["comment(last time)"], "text"),
    ("CAS No.", ["cas no."], "text"), ("Substance Name", ["substance name"], "text"), ("Substance Content(%)", ["substance content(%)"], "text"),
    ("Application ID", ["application id"], "text"), ("Material Name", ["material name"], "text"), ("Mass(g)", ["mass(g)"], "num"),
    ("Drawing Mass Max (g)", ["drawing mass(g) max"], "num"), ("Drawing Mass Min (g)", ["drawing mass(g) min"], "num"),
]
JUDGE = [
    ("Assigned person", ["assigned person"], "text"), ("Starting date", ["the starting date"], "date"),
    ("Judgment procedure", ["judgment procedure"], "text"), ("Judge OK/NG", ["judge (ok/ng)"], "judge"),
    ("Comment of changing to OK", ["comment of [record of changing to ”ok” (required)]", 'comment of [record of changing to "ok" (required)]'], "text"),
    ("IMDS Reject comment", ["imds reject comment"], "text"), ("KM Judge", ["km judge (ok/ng)"], "judge"), ("KM Comment", ["km comment"], "text"),
    ("Last Change Date", ["last change date"], "text"),
]
REMIND = ["Supplier reminder", "Last reminder sent", "Reminder count"]
HEAD = ["code"] + [h for h, _, _ in SOURCE] + [h for h, _, _ in JUDGE] + ["Judgement state"] + REMIND + ["Code origin", "Source", "Search key"]
IDX = {h: i for i, h in enumerate(HEAD)}

def conv(v, kind):
    if kind == "date": return as_date(v)
    if kind == "int": t = s(v); return int(t) if t.isdigit() else (t or None)
    if kind == "num": return num(v) if s(v) else None
    if kind == "judge": return judge_of(v)
    return s(v)

def read_log(path, sheet_hint):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet_hint] if sheet_hint in wb.sheetnames else wb.worksheets[0]
    head_row = None
    for n, r in enumerate(ws.iter_rows(min_row=1, max_row=12, values_only=True), start=1):
        names = [hnorm(x) for x in r]
        if "error type" in names and "download date" in names: head_row, header = n, names; break
    if not head_row: raise SystemExit(f"{path}: no G-CATS header row found")
    first = {}
    for i, h in enumerate(header):
        first.setdefault(h, i)
    out = []
    for n, r in enumerate(ws.iter_rows(min_row=head_row + 1, values_only=True), start=head_row + 1):
        get = lambda names: next((r[first[x]] for x in names if x in first and first[x] < len(r)), None)
        if not s(get(["error type"])) and not s(get(["delivery part no"])): continue
        rec = {h: conv(get(src), kind) for h, src, kind in SOURCE + JUDGE}
        d = rec["Download Date"]
        if d and not rec["Year"]: rec["Year"] = d.year
        if d and not rec["Month"]: rec["Month"] = d.strftime("%b")
        code = s(get(["code"])); origin = "G-CATS code"
        if not code:
            no = s(get(["no."]))
            if d and no.isdigit(): code, origin = d.strftime("%Y%m%d") + no.zfill(3), "Derived: Download Date + No."
            else: continue
        out.append((code, origin, rec, n))
    return out, ws.title

report = {"sources": [], "conflicts": [], "registerOnly": 0}
rows = collections.OrderedDict()
def take(entries, source):
    added = updated = 0
    for code, origin, rec, srow in entries:
        if code in rows:
            cur = rows[code]
            for h, _, _ in SOURCE:
                if rec[h] not in ("", None): cur["rec"][h] = rec[h]
            for h, _, _ in JUDGE:
                if rec[h] not in ("", None) and cur["rec"][h] in ("", None): cur["rec"][h] = rec[h]
            cur["source"] = source; updated += 1
        else:
            rows[code] = {"origin": origin, "rec": rec, "source": f"{source} r{srow}"}; added += 1
    return added, updated

m_entries, m_sheet = read_log(master_path, "G-CATS Error Log Master Data")
report["sources"].append({"file": master_path.split("/")[-1], "sheet": m_sheet, "rows": len(m_entries), "added": take(m_entries, "Master")[0]})
for p in daily_paths:
    e, sh = read_log(p, "Sheet1")
    a, u = take(e, p.split("/")[-1][:40])
    report["sources"].append({"file": p.split("/")[-1], "sheet": sh, "rows": len(e), "added": a, "refreshed": u})

# Values the website already wrote through Power Automate win over the workbook's (the website is the editable master).
kept_from_register = 0
if register_path:
    wr = openpyxl.load_workbook(register_path, data_only=True)
    ws0 = wr["JudgementRegister"]
    h0 = [s(c.value) for c in ws0[1]]
    for r in ws0.iter_rows(min_row=2, values_only=True):
        code = re.sub(r"^code:", "", s(r[0]))
        if not code or code.startswith("EXAMPLE"): continue
        vals = {h: r[i] for i, h in enumerate(h0) if i < len(r)}
        if code not in rows:
            rec = {h: conv(vals.get(h), kind) for h, _, kind in SOURCE + JUDGE}
            rows[code] = {"origin": "Register only", "rec": rec, "source": "Current register"}; report["registerOnly"] += 1
            continue
        cur = rows[code]["rec"]
        for h, _, kind in JUDGE:
            v = conv(vals.get(h), kind)
            if v not in ("", None):
                if cur[h] not in ("", None) and str(cur[h]) != str(v): report["conflicts"].append({"code": code, "column": h, "workbook": str(cur[h]), "register (kept)": str(v)})
                cur[h] = v; kept_from_register += 1
report["valuesKeptFromRegister"] = kept_from_register

# Chronological like the master: Download Date, then No.; the newest download at the bottom.
def key(item):
    code, x = item; d = x["rec"]["Download Date"]; no = x["rec"]["No."]
    return (d or datetime.date(1900, 1, 1), no if isinstance(no, int) else 0, code)
ordered = sorted(rows.items(), key=key)

SUPPLIER_TYPES = re.compile(r"mass tolerance|sms mass|application ?44|prohibited|not specified|mass deviation|supplied is not sms", re.I)
wb = openpyxl.Workbook()
ws = wb.active; ws.title = "JudgementRegister"
ws.append(HEAD)
R = lambda c: f"JudgementRegister[[#This Row],[{c}]]"
STATE_F = (f'=IF({R("KM Judge")}<>"","Judged by TMA",IF({R("Judge OK/NG")}<>"","Waiting TMA",'
           f'IF(OR(UPPER(TRIM({R("G-CATS Status")}))="WORKING",{R("G-CATS Status")}=""),"To judge","Closed in G-CATS")))')
SEARCH_F = (f'={R("code")}&" "&{R("Delivery Part No")}&" "&{R("Supplier Code")}&" "&{R("Company Name")}&" "&{R("Error Type")}'
            f'&" "&{R("CAS No.")}&" "&{R("Substance Name")}&" "&{R("Assigned person")}')
states = collections.Counter()
for code, x in ordered:
    rec = x["rec"]
    st = rec["G-CATS Status"].upper()
    state = "Judged by TMA" if rec["KM Judge"] else "Waiting TMA" if rec["Judge OK/NG"] else "To judge" if st in ("WORKING", "") else "Closed in G-CATS"
    states[state] += 1
    remind = "Y" if state == "To judge" and SUPPLIER_TYPES.search(rec["Error Type"]) else ""
    ws.append([code] + [rec[h] for h, _, _ in SOURCE] + [rec[h] for h, _, _ in JUDGE] + [STATE_F, remind, None, 0, x["origin"], x["source"], SEARCH_F])
last = ws.max_row
t = Table(displayName="JudgementRegister", ref=f"A1:{L(len(HEAD))}{last}")
t.tableStyleInfo = TableStyleInfo(name="TableStyleLight9", showRowStripes=True)
t._initialise_columns()
for tc in t.tableColumns:
    if tc.name == "Judgement state": tc.calculatedColumnFormula = TableFormula(attr_text=STATE_F[1:])
    if tc.name == "Search key": tc.calculatedColumnFormula = TableFormula(attr_text=SEARCH_F[1:])
ws.add_table(t)

# ---- look ----
base = Font(name=FONT, size=10); bold = Font(name=FONT, size=10, bold=True, color="FFFFFF")
thin = Side(style="thin", color="D9D2BE")
WIDTH = {"code": 15, "Year": 7, "Month": 8, "No.": 6, "Download Date": 13, "G-CATS Status": 13, "Error Type": 24, "Company Name": 30, "Supplier Code": 11,
         "Delivery Part No": 16, "Delivery Part Name": 32, "ELV Part": 8, "Module ID": 13, "Version": 9, "Comment(last time)": 26, "CAS No.": 13,
         "Substance Name": 24, "Substance Content(%)": 11, "Application ID": 11, "Material Name": 20, "Mass(g)": 10, "Drawing Mass Max (g)": 12, "Drawing Mass Min (g)": 12,
         "Assigned person": 15, "Starting date": 12, "Judgment procedure": 48, "Judge OK/NG": 10, "Comment of changing to OK": 34, "IMDS Reject comment": 30,
         "KM Judge": 10, "KM Comment": 30, "Last Change Date": 20, "Judgement state": 16, "Supplier reminder": 10, "Last reminder sent": 14, "Reminder count": 9,
         "Code origin": 22, "Source": 22, "Search key": 12}
for h, i in IDX.items(): ws.column_dimensions[L(i + 1)].width = WIDTH.get(h, 14)
ws.row_dimensions[1].height = 36
for c in ws[1]:
    c.font = bold; c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="left", indent=1)
    c.fill = PatternFill("solid", fgColor="20543B" if IDX[c.value] < IDX["Assigned person"] else "7E5D1F" if IDX[c.value] < IDX["Judgement state"] else "45708F")
TEXT_COLS = {IDX[h] for h in ("code", "Supplier Code", "Delivery Part No", "Module ID", "Version", "CAS No.", "Application ID")}
DATE_COLS = {IDX[h] for h in ("Download Date", "Starting date", "Last reminder sent")}
WRAP_COLS = {IDX[h] for h in ("Judgment procedure", "Comment of changing to OK", "IMDS Reject comment", "KM Comment", "Comment(last time)")}
for row in ws.iter_rows(min_row=2, max_row=last):
    for c in row:
        c.font = base; c.alignment = Alignment(vertical="top", wrap_text=c.column - 1 in WRAP_COLS)
        if c.column - 1 in TEXT_COLS: c.number_format = "@"
        if c.column - 1 in DATE_COLS: c.number_format = "dd mmm yyyy"
ws.freeze_panes = ws.cell(2, IDX["Delivery Part No"] + 2)   # code … Delivery Part No stay visible
ws.sheet_view.zoomScale = 90
ws.column_dimensions[L(IDX["Search key"] + 1)].hidden = True
J, K, S = (L(IDX[h] + 1) for h in ("Judge OK/NG", "KM Judge", "Judgement state"))
for col in (J, K):
    dv = DataValidation(type="list", formula1='"OK,NG"', allow_blank=True, showErrorMessage=True, errorTitle="OK or NG", error="Judge is OK, NG or empty.")
    dv.add(f"{col}2:{col}{last}"); ws.add_data_validation(dv)
    ws.conditional_formatting.add(f"{col}2:{col}{last}", FormulaRule(formula=[f'${col}2="OK"'], fill=PatternFill("solid", fgColor="E2ECDF"), font=Font(name=FONT, bold=True, color="2F7049")))
    ws.conditional_formatting.add(f"{col}2:{col}{last}", FormulaRule(formula=[f'${col}2="NG"'], fill=PatternFill("solid", fgColor="F4E1DD"), font=Font(name=FONT, bold=True, color="A63F3F")))
FILLS = {"To judge": ("F5E9CC", "7A5310"), "Waiting TMA": ("E0E8EF", "45708F"), "Judged by TMA": ("E2ECDF", "2F7049"), "Closed in G-CATS": ("EEEEEE", "56665B")}
for k, (bg, fg) in FILLS.items():
    ws.conditional_formatting.add(f"{S}2:{S}{last}", FormulaRule(formula=[f'${S}2="{k}"'], fill=PatternFill("solid", fgColor=bg), font=Font(name=FONT, bold=True, color=fg)))
dvr = DataValidation(type="list", formula1='"Y,N"', allow_blank=True)
dvr.add(f"{L(IDX['Supplier reminder'] + 1)}2:{L(IDX['Supplier reminder'] + 1)}{last}"); ws.add_data_validation(dvr)

def title(sh, text, sub):
    sh["B2"] = text; sh["B2"].font = Font(name=FONT, size=18, bold=True, color="193528")
    sh["B3"] = sub; sh["B3"].font = Font(name=FONT, size=10, color="56665B")
    sh.sheet_view.showGridLines = False
    sh.column_dimensions["A"].width = 3

def result_sheet(name, heading, sub, cond, cols, rows_n, inputs):
    """A list that fills itself from the table (array formulas: no macros, works in Excel and LibreOffice)."""
    sh = wb.create_sheet(name)
    title(sh, heading, sub)
    for (cell, label, value, note) in inputs:
        lab = sh.cell(cell[0], cell[1] - 1 if cell[1] > 2 else 2)
        sh.cell(cell[0] - 1, cell[1], label).font = Font(name=FONT, size=9, bold=True, color="56665B")
        c = sh.cell(cell[0], cell[1], value); c.font = Font(name=FONT, size=12, bold=True, color="193528")
        c.fill = PatternFill("solid", fgColor="FAF8F0"); c.border = Border(left=thin, right=thin, top=thin, bottom=thin)
        if note: sh.cell(cell[0] + 1, cell[1], note).font = Font(name=FONT, size=9, italic=True, color="56665B")
    hr = 9
    sh.cell(hr - 1, 2, "Showing").font = Font(name=FONT, size=9, color="56665B")
    sh.cell(hr - 1, 3, f'=COUNT(B{hr + 1}:B{hr + rows_n})&" of "&SUMPRODUCT(--({cond}))&" matching rows"').font = Font(name=FONT, size=9, bold=True, color="193528")
    sh.cell(hr, 2, "#").font = bold
    for j, h in enumerate(cols, start=3): sh.cell(hr, j, h).font = bold
    for j in range(2, 3 + len(cols)):
        c = sh.cell(hr, j); c.fill = PatternFill("solid", fgColor="20543B"); c.alignment = Alignment(vertical="center", wrap_text=True, indent=1)
    sh.row_dimensions[hr].height = 30
    rowvec = "(ROW(JudgementRegister[code])-ROW(JudgementRegister[#Headers]))"
    for k in range(1, rows_n + 1):
        r = hr + k
        f = f'=IFERROR(SMALL(IF({cond},{rowvec}),{k}),"")'
        sh.cell(r, 2).value = ArrayFormula(f"B{r}", f); sh.cell(r, 2).font = Font(name=FONT, size=8, color="9A9A9A")
        for j, h in enumerate(cols, start=3):
            if h in ("Download Date", "Starting date"):
                c = sh.cell(r, j, f'=IF($B{r}="","",IF(INDEX(JudgementRegister[{h}],$B{r})="","",INDEX(JudgementRegister[{h}],$B{r})))'); c.number_format = "dd mmm yyyy"
            else:
                c = sh.cell(r, j, f'=IF($B{r}="","",INDEX(JudgementRegister[{h}],$B{r})&"")')
            c.font = base; c.alignment = Alignment(vertical="top", wrap_text=h in ("Judgment procedure", "Comment of changing to OK", "IMDS Reject comment", "KM Comment"))
            c.border = Border(bottom=Side(style="hair", color="DAD2BE"))
    sh.column_dimensions["B"].width = 6
    for j, h in enumerate(cols, start=3): sh.column_dimensions[L(j)].width = WIDTH.get(h, 14)
    sh.freeze_panes = sh.cell(hr + 1, 3)
    return sh

SEARCH_COLS = ["code", "Download Date", "No.", "G-CATS Status", "Error Type", "Company Name", "Supplier Code", "Delivery Part No", "Delivery Part Name", "CAS No.", "Substance Name",
               "Assigned person", "Judge OK/NG", "Comment of changing to OK", "IMDS Reject comment", "KM Judge", "KM Comment", "Judgement state"]
sr = result_sheet("Search", "Search the register", "Type any part of a code, part number, supplier code or name, error type, CAS, substance or person. Results update by themselves.",
                  '((Search!$C$5="")+ISNUMBER(SEARCH(Search!$C$5,JudgementRegister[Search key]))>0)*((Search!$G$5="All")+(JudgementRegister[Judgement state]=Search!$G$5)>0)',
                  SEARCH_COLS, 300, [((5, 3), "SEARCH FOR", "", "e.g. 616770D080 · 5376 · WARP · 7439-92-1"), ((5, 7), "JUDGEMENT STATE", "All", "")])
sr.merge_cells("C5:E5")
dvs = DataValidation(type="list", formula1='"All,To judge,Waiting TMA,Judged by TMA,Closed in G-CATS"', allow_blank=False); dvs.add("G5"); sr.add_data_validation(dvs)

TMA_COLS = ["code", "No.", "Download Date", "Company Name", "Supplier Code", "Delivery Part No", "Delivery Part Name", "Error Type", "Comment(last time)",
            "Judgment procedure", "Judge OK/NG", "Comment of changing to OK", "IMDS Reject comment", "Assigned person", "Starting date", "KM Judge", "KM Comment"]
result_sheet("For TMA", "Waiting for TMA to judge", "Our judgement is done (Judge OK/NG set) and TMA's KM Judge is still empty. Copy this list to TMA. It updates by itself.",
             '(JudgementRegister[Judgement state]="Waiting TMA")', TMA_COLS, 1500, [])

# Summary
sm = wb.create_sheet("Summary")
title(sm, "Judgement register summary", "Every number follows the JudgementRegister table, so it stays right as the website writes judgements.")
sm["B5"], sm["C5"] = "Judgement state", "Rows"
for c in (sm["B5"], sm["C5"]): c.font = bold; c.fill = PatternFill("solid", fgColor="20543B")
for i, (k, (bg, fg)) in enumerate(FILLS.items(), start=6):
    sm[f"B{i}"] = k; sm[f"C{i}"] = f'=COUNTIF(JudgementRegister[Judgement state],"{k}")'
    for c in (sm[f"B{i}"], sm[f"C{i}"]): c.fill = PatternFill("solid", fgColor=bg); c.font = Font(name=FONT, size=11, bold=True, color=fg)
sm["B10"] = "Total"; sm["C10"] = "=ROWS(JudgementRegister[code])"
for c in (sm["B10"], sm["C10"]): c.font = Font(name=FONT, size=11, bold=True)
sm["B12"] = "Newest download in the register"; sm["C12"] = "=MAX(JudgementRegister[Download Date])"; sm["C12"].number_format = "dd mmm yyyy"
sm["B13"] = "Codes derived (no TMA code yet)"; sm["C13"] = '=COUNTIF(JudgementRegister[Code origin],"Derived*")'
sm["B14"] = "Rows marked for supplier reminder"; sm["C14"] = '=COUNTIF(JudgementRegister[Supplier reminder],"Y")'
for r in (12, 13, 14): sm[f"B{r}"].font = base; sm[f"C{r}"].font = Font(name=FONT, size=10, bold=True)
sm["B16"] = "Error Type"; sm["C16"] = "To judge"; sm["D16"] = "Waiting TMA"; sm["E16"] = "Judged by TMA"; sm["F16"] = "Total"
for c in sm[16][1:6]: c.font = bold; c.fill = PatternFill("solid", fgColor="20543B")
types = collections.Counter(x["rec"]["Error Type"] for _, x in ordered if x["rec"]["Error Type"])
for i, (et, _) in enumerate(types.most_common(), start=17):
    sm[f"B{i}"] = et; sm[f"B{i}"].font = base
    for col, st in zip("CDE", ("To judge", "Waiting TMA", "Judged by TMA")):
        sm[f"{col}{i}"] = f'=COUNTIFS(JudgementRegister[Error Type],$B{i},JudgementRegister[Judgement state],"{st}")'; sm[f"{col}{i}"].font = base
    sm[f"F{i}"] = f'=COUNTIF(JudgementRegister[Error Type],$B{i})'; sm[f"F{i}"].font = Font(name=FONT, size=10, bold=True)
sm.column_dimensions["B"].width = 40
for col in "CDEF": sm.column_dimensions[col].width = 15

# SupplierContacts: the daily reminder flow looks the PIC up here (standard Excel connector).
sc = wb.create_sheet("SupplierContacts")
sc.append(["Supplier Code", "Supplier Name", "PIC Email", "CC Emails", "Send reminders", "Language", "Notes"])
need = collections.OrderedDict()
for code, x in ordered:
    rec = x["rec"]
    if rec["Supplier Code"] and rec["Supplier Code"] not in need: need[rec["Supplier Code"]] = rec["Company Name"]
for code, name in sorted(need.items()): sc.append([code, name, "", "", "Y", "EN", ""])
sc.add_table(Table(displayName="SupplierContacts", ref=f"A1:G{max(2, sc.max_row)}", tableStyleInfo=TableStyleInfo(name="TableStyleLight9", showRowStripes=True)))
for col, w in zip("ABCDEFG", [14, 40, 34, 44, 15, 10, 30]): sc.column_dimensions[col].width = w
for row in sc.iter_rows():
    for c in row: c.font = base if c.row > 1 else bold
    row[0].number_format = "@"
for c in sc[1]: c.fill = PatternFill("solid", fgColor="20543B")

# Read me
rm = wb.create_sheet("Read me")
title(rm, "How this register works", f"Built {datetime.date.today():%d %b %Y} from {', '.join(x['file'] for x in report['sources'])}.")
notes = [
    "JudgementRegister is the table Power Automate writes to. Do not rename it or its headers; you may add columns at the end.",
    "Order follows Master Data All IMDS: oldest first, newest download at the bottom. Daily G-CATS files are re-ordered by Download Date + No.",
    "code = TMA's code, or Download Date (YYYYMMDD) + No. (3 digits) while TMA has not given one. Same rule TMA uses, so judgements carry over.",
    "Judgement state: To judge = WORKING and no Judge · Waiting TMA = our Judge set, KM empty · Judged by TMA = KM Judge set · Closed in G-CATS = not WORKING, not judged.",
    "Search: type in the yellow box. For TMA: the list to send to TMA (our judgement done, TMA not yet).",
    "Website judgements arrive through Power Automate (Office Script UpsertRows or Update a row by code). New daily rows are added at the bottom.",
    "PROTECTED · internal use. Supplier-facing extracts only through the website's supplier e-mails.",
]
for i, n in enumerate(notes, start=5):
    rm.cell(i, 2, "•").font = Font(name=FONT, size=11, bold=True, color="20543B")
    c = rm.cell(i, 3, n); c.font = Font(name=FONT, size=11); c.alignment = Alignment(wrap_text=True, vertical="top")
    rm.row_dimensions[i].height = 32
rm.column_dimensions["B"].width = 3; rm.column_dimensions["C"].width = 120

wb.move_sheet("Summary", offset=-(len(wb.sheetnames) - 1))
wb.active = wb.sheetnames.index("JudgementRegister")
wb.calculation.fullCalcOnLoad = True
wb.save(out_path)

report.update({"rows": len(ordered), "states": states, "derivedCodes": sum(1 for _, x in ordered if x["origin"].startswith("Derived")),
               "firstRow": ordered[0][0] if ordered else None, "lastRow": ordered[-1][0] if ordered else None})
json.dump(report, open(report_path, "w"), default=str, indent=1)
print(json.dumps({k: report[k] for k in ("rows", "states", "derivedCodes", "registerOnly", "valuesKeptFromRegister", "firstRow", "lastRow")}, default=str))
print("sources", json.dumps(report["sources"]), "conflicts", len(report["conflicts"]))
