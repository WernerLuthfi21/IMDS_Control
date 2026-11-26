"use client";
import { useEffect,useState } from "react";
import { SettingsTabs } from "@/components/settings-tabs";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { TrackerMascot } from "./tracker-mascot";
import { trackerViews,trackerViewFromHash } from "./foundation-state";
/** Stage 8 only: no master-data requests, writes, provider calls or operational controls. */
export function TrackerFoundation({fixture=false}:{fixture?:boolean}){
 const [view,setView]=useState("overview"),[note,setNote]=useState("");
 useEffect(()=>{const read=()=>setView(trackerViewFromHash(location.hash));read();window.addEventListener("hashchange",read);window.addEventListener("popstate",read);return()=>{window.removeEventListener("hashchange",read);window.removeEventListener("popstate",read);};},[]);
 const current=trackerViews.find(v=>v.id===view)!;
 return <section className="trk-foundation" aria-label="Tracker migration foundation">
  <div className="trk-hero"><div><div className="trk-note">IMDS TRACKER · {fixture?"SYNTHETIC FIXTURE":"MIGRATION PREVIEW"}</div><h1>{current.label}</h1><p>Stage 8 — shared application foundation. Operational functions remain in the existing Tracker until parity is verified.</p><div className="trk-row">{!fixture&&<a className="btn btn-primary" href={"/imds-tracker#"+view}>Open existing {current.label}</a>}<span className="trk-note">No data or messages are changed here.</span></div></div><TrackerMascot/></div>
  {fixture&&<section className="trk-panel"><h2>Theme and interaction fixture</h2><SettingsTabs compact syncHash={false} label="Fixture sections" tabs={[
    {id:"source",label:"Data source",hint:"Synthetic only",content:<div className="trk-row"><button type="button" className="btn" onClick={async()=>setNote(await confirmAction({title:"Fixture confirmation",body:"No operation is performed.",confirmLabel:"Confirm"})?"Confirmed fixture":"Cancelled fixture")}>Open confirmation</button><button type="button" className="btn" disabled>Unavailable action</button><span role="status">{note}</span></div>},
    {id:"models",label:"Models & display",hint:"Local controls",content:<label>Model name<input defaultValue="FIXTURE-MODEL" /></label>},
    {id:"templates",label:"Templates",hint:"Local draft",content:<><label>Channel<select defaultValue="Email"><option>Email</option><option>WhatsApp</option></select></label><label>Message preview<textarea defaultValue="Synthetic draft. No recipient."/></label></>}
  ]}/></section>}
  {!fixture&&<section className="trk-panel"><h2>Migration status</h2><p>This view is not yet migrated. Use the existing Tracker for imports, reports, settings and communication.</p><a className="btn" href="/imds-tracker">Return to existing Tracker</a></section>}
 </section>;
}
