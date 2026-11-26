"use client";
import {useEffect,useState} from "react";
import {validIso,type DueDates} from "@/lib/imds-master/due-dates";
import styles from "./workbench.module.css";
type Loaded={value:DueDates;version:number;tableMissing?:boolean};
export function DeadlineEditor({models,role,onSaved}:{models:string[];role:string;onSaved:()=>void}){
 const [loaded,setLoaded]=useState<Loaded|null>(null),[model,setModel]=useState(""),[date,setDate]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[conflict,setConflict]=useState(false);
 const canEdit=["admin","preparer","reviewer"].includes(role);
 async function load(){setBusy(true);setNotice("");try{const r=await fetch("/api/imds-master/settings?key=due_dates",{cache:"no-store"});const data=await r.json();if(!r.ok||data.tableMissing)throw Error("Shared deadline settings are unavailable.");setLoaded(data);setConflict(false);setDate(model?data.value.models[model]||"":"")}catch(e){setLoaded(null);setNotice(e instanceof Error?e.message:"Unable to load settings.")}finally{setBusy(false)}}
 useEffect(()=>{void load()},[]);
 const changed=!!loaded&&!!model&&date!==(loaded.value.models[model]||"");
 async function save(){if(!loaded||!canEdit||!changed||conflict||busy||!models.includes(model)||date&&!validIso(date))return;setBusy(true);setNotice("");
  const next={...loaded.value,models:{...loaded.value.models}};if(date)next.models[model]=date;else delete next.models[model];
  try{const r=await fetch("/api/imds-master/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:"due_dates",value:next,baseVersion:loaded.version})});const data=await r.json();if(r.status===409){setConflict(true);throw Error("Another user changed the deadlines. Your input is retained; reload and review before saving again.")}if(!r.ok)throw Error(data.error||"Save failed.");setLoaded({value:next,version:data.version});setNotice("Shared model deadline saved.");onSaved()}catch(e){setNotice(e instanceof Error?e.message:"Save failed.")}finally{setBusy(false)}}
 return <section className={styles.panel}><h2>Shared model deadlines</h2><p>Model defaults only. Supplier-specific overrides are preserved. No automatic send or change to acceptance status.</p>
 <div className={styles.actions}><label>Model <select aria-label="Deadline model" value={model} disabled={busy||conflict} onChange={e=>{setModel(e.target.value);setDate(loaded?.value.models[e.target.value]||"");setNotice("")}}><option value="">Choose model</option>{models.filter(m=>m!=="UNASSIGNED").map(m=><option key={m}>{m}</option>)}</select></label>
 <label>Shared deadline <input type="date" aria-label="Shared model deadline" value={date} min="2000-01-01" max="2100-12-31" disabled={!model||!canEdit||busy||conflict||!loaded} onChange={e=>setDate(e.target.value)}/></label>
 <button disabled={!canEdit||!changed||busy||conflict||!!date&&!validIso(date)} onClick={save}>Save deadline</button><button disabled={busy} onClick={()=>{if(changed&&!window.confirm("Discard the local deadline edit and reload shared settings?"))return;void load()}}>Reload settings</button></div>
 {!canEdit&&<p>Read-only for this role.</p>}<p role="status">{notice||(busy?"Working…":loaded?"Shared settings version "+loaded.version:"Loading settings…")}</p><a href="/imds-tracker?section=models#settings">Supplier overrides and model display controls</a></section>
}
