import type { Bucket } from "@/lib/followup/render";
export type Totals = Record<Bucket, number> & { total: number; overdue: number; missedPromise: number; missingDeadline: number };
export type WorkbenchGroup = Totals & { key: string; name: string; code: string; contact: boolean };
export type WorkbenchRow = { id: string; supplier: string; supplierKey: string; model: string; part: string; status: Bucket; deadline: string | null; promise: string | null; overdue: boolean; missedPromise: boolean; contact: boolean };
export type WorkbenchEvent = { id: string; time: string; state: string; parts: number };
export const zeroTotals = (): Totals => ({ total:0, complete:0, missing:0, rejected:0, process:0, review:0, stop:0, overdue:0, missedPromise:0, missingDeadline:0 });
export function countRows(rows: WorkbenchRow[]): Totals {
  const t=zeroTotals();
  for(const r of rows){t.total++;t[r.status]++;if(r.overdue)t.overdue++;if(r.missedPromise)t.missedPromise++;if((r.status==="missing"||r.status==="rejected")&&!r.deadline)t.missingDeadline++;}
  return t;
}
export function groupRows(rows: WorkbenchRow[], by:"model"|"supplier"): WorkbenchGroup[] {
  const groups=new Map<string,WorkbenchRow[]>();
  for(const r of rows){const k=by==="model"?r.model:r.supplierKey;const g=groups.get(k)||[];g.push(r);groups.set(k,g);}
  return [...groups].map(([key,g])=>({...countRows(g),key,name:by==="model"?key:g[0].supplier,code:by==="supplier"&&key.startsWith("code:")?key.slice(5):"",contact:g.some(r=>r.contact)}))
    .sort((a,b)=>b.overdue-a.overdue||b.missedPromise-a.missedPromise||b.rejected-a.rejected||b.missing-a.missing||a.name.localeCompare(b.name));
}

export type WorkbenchScope={model:string;search:string;status:string};
export function filterWorkbenchRows(rows:WorkbenchRow[],scope:WorkbenchScope):WorkbenchRow[]{
 const q=scope.search.trim().toLowerCase();
 return rows.filter(r=>(!scope.model||r.model===scope.model)&&(!q||[r.supplier,r.supplierKey,r.part,r.model].join(" ").toLowerCase().includes(q))&&(!scope.status||(scope.status==="overdue"?r.overdue:scope.status==="missed"?r.missedPromise:r.status===scope.status)));
}
