"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Check, LoaderCircle, Users, X } from "lucide-react";

type RegisterRow = {
  id: string; source_record_key: string; error_type_label: string; delivery_part_no: string | null;
  supplier_code: string | null; judge: string | null; km_judge: string | null;
  source_judge_label: string | null; source_km_judge_label: string | null;
  assigned_person: string | null; starting_date: string | null; last_change_date: string | null;
};

export function RegisterTable({ rows }: { rows: RegisterRow[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [showBulk, setShowBulk] = useState(false);
  const [assignedPerson, setAssignedPerson] = useState("");
  const [startingDate, setStartingDate] = useState("");
  const [procedure, setProcedure] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selectedRows = useMemo(() => rows.filter((row) => selected.includes(row.id)), [rows, selected]);
  const selectedTypes = [...new Set(selectedRows.map((row) => row.error_type_label))];
  const canBulk = selectedRows.length >= 2 && selectedTypes.length === 1;
  const allSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id));

  function toggle(id: string) {
    setSelected((old) => old.includes(id) ? old.filter((value) => value !== id) : [...old, id]);
    setError(""); setMessage("");
  }
  function togglePage() { setSelected((old) => allSelected ? old.filter((id) => !rows.some((row) => row.id === id)) : [...new Set([...old, ...rows.map((row) => row.id)])]); }
  async function applyBulk(event: React.FormEvent) {
    event.preventDefault();
    if (!canBulk) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const payload: Record<string, unknown> = { ids: selected };
      if (assignedPerson.trim()) payload.assigned_person = assignedPerson.trim();
      if (startingDate) payload.starting_date = startingDate;
      if (procedure.trim()) payload.judgement_procedure = procedure.trim();
      if (Object.keys(payload).length === 1) throw new Error("Enter at least one field to apply.");
      const response = await fetch("/api/register/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Bulk preparation failed.");
      setMessage(`${json.updated} records updated for ${json.errorType}. Judge and KM fields were not changed.`);
      setSelected([]); setAssignedPerson(""); setStartingDate(""); setProcedure(""); setShowBulk(false);
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Bulk preparation failed."); }
    finally { setBusy(false); }
  }

  return <>
    {selected.length > 0 && <div className="bulk-toolbar">
      <div><strong>{selected.length} selected</strong><span>{selectedTypes.length === 1 ? selectedTypes[0] : "Mixed Error Types"}</span></div>
      <div className="bulk-toolbar-actions">
        <button className="btn btn-sm" type="button" onClick={() => setSelected([])}><X size={13}/> Clear selection</button>
        <button className="btn btn-sm btn-primary" type="button" disabled={!canBulk} onClick={() => setShowBulk((value) => !value)}><Users size={13}/> Bulk preparation</button>
      </div>
    </div>}
    {showBulk && <form className="bulk-editor" onSubmit={applyBulk}>
      <div className="bulk-editor-heading"><div><strong>Apply common preparation</strong><span>Only selected records with the same exact Error Type can be updated. Final OK/NG and KM judgement remain per-record.</span></div><button className="icon-button" type="button" onClick={() => setShowBulk(false)} aria-label="Close bulk preparation"><X size={16}/></button></div>
      <div className="bulk-fields">
        <div className="form-field"><label>Assigned person</label><input className="field" value={assignedPerson} onChange={(event) => setAssignedPerson(event.target.value)} placeholder="Leave blank to keep current values"/></div>
        <div className="form-field"><label>Starting date</label><input className="field" type="date" value={startingDate} onChange={(event) => setStartingDate(event.target.value)}/></div>
        <div className="form-field bulk-procedure"><label>Judgement procedure</label><textarea className="textarea-field" rows={3} value={procedure} onChange={(event) => setProcedure(event.target.value)} placeholder="Common procedure to apply to the selected cases…"/></div>
      </div>
      {error && <div className="bulk-feedback error">{error}</div>}
      {message && <div className="bulk-feedback success">{message}</div>}
      <div className="bulk-submit"><span>Source history and each record's individual evidence remain separate.</span><button className="btn btn-primary" disabled={busy || (!assignedPerson.trim() && !startingDate && !procedure.trim())}>{busy ? <LoaderCircle size={13}/> : <Check size={13}/>} Apply to {selectedRows.length} records</button></div>
    </form>}
    <div className="table-scroll"><table className="register-table"><thead><tr><th className="select-col"><input type="checkbox" checked={allSelected} onChange={togglePage} aria-label="Select all records on this page"/></th><th>Source code</th><th>Delivery part no.</th><th>Supplier</th><th>Error Type</th><th>Assigned person</th><th>Start date</th><th>Judge</th><th>KM Judge</th><th>Last change</th><th/></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id} className={selected.includes(row.id) ? "row-selected" : ""}>
        <td className="select-col"><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} aria-label={`Select ${row.delivery_part_no || row.source_record_key}`}/></td>
        <td className="mono">{row.source_record_key}</td><td className="cell-strong">{row.delivery_part_no || "—"}</td><td className="mono">{row.supplier_code || "—"}</td><td>{row.error_type_label}</td><td>{row.assigned_person || <span className="muted">Unassigned</span>}</td><td>{row.starting_date || "—"}</td>
        <td><span className={`state-pill ${row.judge === "OK" ? "state-ok" : row.judge === "NG" ? "state-ng" : "state-pending"}`}>{row.judge || (row.source_judge_label ? "Review source" : "Pending")}</span></td>
        <td><span className={`state-pill ${row.km_judge === "OK" ? "state-ok" : row.km_judge === "NG" ? "state-ng" : "state-pending"}`}>{row.km_judge || (row.source_km_judge_label ? "Review source" : "Pending")}</span></td>
        <td>{row.last_change_date ? new Date(row.last_change_date).toLocaleDateString("en-GB") : "—"}</td><td><Link className="row-open" href={`/register/${row.id}`} aria-label={`Open ${row.delivery_part_no || row.source_record_key}`}><ArrowRight size={15}/></Link></td>
      </tr>)}
    </tbody></table>{rows.length === 0 && <div className="empty-state">No records match the current filters.</div>}</div>
  </>;
}
