"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowUpRight, Check, CircleHelp, ClipboardCheck, Clock3, FileSpreadsheet, Filter, LoaderCircle, Mail, Search, ShieldCheck, Sparkles, Calculator, CircleCheck, CircleX, AlertTriangle } from "lucide-react";

type Item={
  id:string;source_record_key:string;error_type_label:string;delivery_part_no:string|null;supplier_code:string|null;
  source_status:string|null;source_year:string|null;source_month:string|null;judge:string|null;km_judge:string|null;
  source_judge_label:string|null;source_km_judge_label:string|null;assigned_person:string|null;starting_date:string|null;
  judgement_procedure:string|null;ok_comment:string|null;imds_reject_comment:string|null;last_change_date:string|null;
  case_id:string;raw_source?:Record<string,unknown>|null;
};
type Tab="pending"|"judged"|"km";
type Draft={assigned_person:string;starting_date:string;judgement_procedure:string;judge:string;comment:string};
type MassForm={imdsMass:string;drawingMass:string;toleranceClass:string;supplierConfirmation:string};
type EvaluationResult={recommendation:string;comment?:string;reason:string;ruleStatus:string;ruleId:string;manualTasks:string[];evaluations:Array<{nodeId:string;question:string;inputValue:unknown;branch:string;result:string;explanation:string}>;finalDecision:string};
const monthNames:Record<string,string>={"1":"Jan","01":"Jan","2":"Feb","02":"Feb","3":"Mar","03":"Mar","4":"Apr","04":"Apr","5":"May","05":"May","6":"Jun","06":"Jun","7":"Jul","07":"Jul","8":"Aug","08":"Aug","9":"Sep","09":"Sep","10":"Oct","11":"Nov","12":"Dec"};
const massType=(v:string)=>/mass tolerance|tolerance range|error.?type.?7/i.test(v);
const allowedClasses=["MA","MB","MC","MD","ME","MF"];
function sourceValue(row:Item,label:string,column:number):unknown{return row.raw_source?.[`${label} [col ${column}]`];}
function sourceText(row:Item,label:string,column:number):string{
 const value=sourceValue(row,label,column);
 if(value===null||value===undefined)return "";
 return String(value).replace(/\u00a0/g," ").trim();
}
function cleanMass(value:unknown):string{
 if(value===null||value===undefined)return "";
 const text=String(value).replace(/\u00a0/g," ").trim();
 if(!text||text==="***"||/^#(N\/A|VALUE!|REF!|DIV\/0!)/i.test(text))return "";
 return text.replace(/,/g,".");
}
function numberText(value:unknown):string{
 if(value===null||value===undefined||value==="")return "—";
 const number=Number(value);
 return Number.isFinite(number)?new Intl.NumberFormat("en-US",{maximumFractionDigits:4}).format(number):String(value);
}
function initialMassForm(row:Item):MassForm{
 const imds=cleanMass(sourceValue(row,"IMDS mass (g)",51))||cleanMass(sourceValue(row,"Mass(g)",19));
 const drawing=cleanMass(sourceValue(row,"Drawing Mass (g)",54));
 const alternateMax=cleanMass(sourceValue(row,"Drawing Mass(g)\nMax",33));
 const alternateMin=cleanMass(sourceValue(row,"Drawing Mass(g)\nMin",34));
 const classValue=sourceText(row,"Mass Tol. Class",52).toUpperCase();
 return {imdsMass:imds,drawingMass:drawing||(alternateMax&&alternateMax===alternateMin?alternateMax:""),toleranceClass:allowedClasses.includes(classValue)?classValue:"",supplierConfirmation:""};
}
export function JudgementWorkspace({rows,year,role,sourceFile,sourceSheet,sourceDate,queryError}:{rows:Item[];year:number;role:string;sourceFile:string|null;sourceSheet:string|null;sourceDate:string|null;queryError:string|null}) {
 const router=useRouter();
 const [tab,setTab]=useState<Tab>("pending");
 const [errorType,setErrorType]=useState("All Error Types");
 const [search,setSearch]=useState("");
 const [monthFilter,setMonthFilter]=useState("All Months");
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [draft,setDraft]=useState<Draft>({assigned_person:"",starting_date:"",judgement_procedure:"",judge:"",comment:""});
 const [massForm,setMassForm]=useState<MassForm>({imdsMass:"",drawingMass:"",toleranceClass:"",supplierConfirmation:""});
 const [massEvaluation,setMassEvaluation]=useState<EvaluationResult|null>(null);
 const [massBusy,setMassBusy]=useState(false);
 const [massError,setMassError]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 const canEdit=["admin","preparer","reviewer"].includes(role);
 const selected=rows.find(r=>r.id===selectedId)||null;

 const counts=useMemo(()=>({
  pending:rows.filter(r=>r.source_status==="WORKING"&&!r.judge).length,
  judged:rows.filter(r=>!!r.judge).length,
  km:rows.filter(r=>!!r.judge&&!r.km_judge).length
 }),[rows]);
 const types=useMemo(()=>["All Error Types",...Array.from(new Set(rows.map(r=>r.error_type_label))).sort((a,b)=>a.localeCompare(b))],[rows]);
 const visible=useMemo(()=>rows.filter(r=>{
  if(tab==="pending"&&(r.source_status!=="WORKING"||r.judge))return false;
  if(tab==="judged"&&!r.judge)return false;
  if(tab==="km"&&(!r.judge||r.km_judge))return false;
  if(errorType!=="All Error Types"&&r.error_type_label!==errorType)return false;
  if(monthFilter!=="All Months"&&String(r.source_month||"Unknown")!==monthFilter)return false;
  const q=search.trim().toLowerCase();
  return !q||[r.source_record_key,r.delivery_part_no,r.supplier_code,r.error_type_label].some(v=>String(v||"").toLowerCase().includes(q));
 }),[rows,tab,errorType,search,monthFilter]);

 const months=useMemo(()=>{
  const grouped=new Map<string,{total:number;pending:number;judged:number}>();
  for(const row of rows){
   const key=String(row.source_month||"Unknown"),value=grouped.get(key)||{total:0,pending:0,judged:0};
   value.total++;
   if(row.source_status==="WORKING"&&!row.judge)value.pending++;
   if(row.judge)value.judged++;
   grouped.set(key,value);
  }
  return [...grouped.entries()].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true})).map(([key,value])=>({key,name:monthNames[key]||key,...value}));
 },[rows]);

 async function runMassCheck(row:Item,form:MassForm){
  setMassBusy(true);setMassError("");setMassEvaluation(null);
  try{
   const payload:Record<string,unknown>={errorType:row.error_type_label,imdsMass:form.imdsMass||undefined,drawingMass:form.drawingMass||undefined,toleranceClass:form.toleranceClass||undefined,dryRun:true};
   if(form.supplierConfirmation)payload.supplierConfirmation=form.supplierConfirmation;
   const response=await fetch("/api/judgement/evaluate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store"});
   const json=await response.json();
   if(!response.ok)throw new Error(json.error||"Mass tolerance check failed.");
   setMassEvaluation(json.result as EvaluationResult);
  }catch(cause){setMassError(cause instanceof Error?cause.message:"Mass tolerance check failed.");}
  finally{setMassBusy(false);}
 }

 useEffect(()=>{
  if(!selected){setMassEvaluation(null);setMassError("");return;}
  setDraft({
   assigned_person:selected.assigned_person||"",
   starting_date:selected.starting_date||"",
   judgement_procedure:selected.judgement_procedure||"",
   judge:selected.judge==="OK"||selected.judge==="NG"?selected.judge:"",
   comment:selected.judge==="OK"?selected.ok_comment||"":selected.judge==="NG"?selected.imds_reject_comment||"":""
  });
  setMessage("");setError("");setMassError("");setMassEvaluation(null);
  if(massType(selected.error_type_label)){
   const form=initialMassForm(selected);
   setMassForm(form);
   void runMassCheck(selected,form);
  }else{
   setMassForm({imdsMass:"",drawingMass:"",toleranceClass:"",supplierConfirmation:""});
  }
 },[selectedId]);

 function updateMass<K extends keyof MassForm>(key:K,value:MassForm[K]){
  setMassForm(old=>({...old,[key]:value}));
  if(key==="supplierConfirmation")setMassEvaluation(null);
 }
 function appendProcedure(note:string){
  setDraft(old=>({...old,judgement_procedure:old.judgement_procedure?old.judgement_procedure+"\n"+note:note}));
 }
 function applyMassRecommendation(){
  if(!massEvaluation)return;
  if(massEvaluation.recommendation==="RECOMMEND_OK"){
   setDraft(old=>({...old,judge:"OK",comment:massEvaluation.comment||"Confirmed with Drawing."}));
  }else if(massEvaluation.recommendation==="RECOMMEND_NG"){
   setDraft(old=>({...old,judge:"NG",comment:massEvaluation.comment||"Mass is incorrect."}));
  }else return;
  const trace=massEvaluation.evaluations?.[0]?.inputValue;
  appendProcedure("Mass tolerance pre-check: "+massEvaluation.reason+(trace&&typeof trace==="object"?" | "+JSON.stringify(trace):""));
 }
 function preset(k:"drawing"|"supplier"|"mistake"){
  const note=k==="drawing"?"Drawing status, class and TSZ2900 Min/Max plus 10% buffer were checked against the source drawing.":k==="supplier"?"Supplier confirmation A: actual or calculated mass. Attach the supplier's evidence and response date.":"Supplier confirmation B: input mistake. Record the corrected value and supporting evidence.";
  appendProcedure(note);
 }

 async function save(){
  if(!selected||!canEdit)return;
  setBusy(true);setMessage("");setError("");
  try{
   if(massType(selected.error_type_label)){
    const evaluationResponse=await fetch("/api/judgement/evaluate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
     caseId:selected.case_id||undefined,errorType:selected.error_type_label,imdsMass:massForm.imdsMass,drawingMass:massForm.drawingMass,
     toleranceClass:massForm.toleranceClass,supplierConfirmation:massForm.supplierConfirmation||undefined
    })});
    const evaluationJson=await evaluationResponse.json();
    if(!evaluationResponse.ok)throw new Error(evaluationJson.error||"Could not record the Type 7 evaluation trace.");
   }
   const payload={
    assigned_person:draft.assigned_person,
    starting_date:draft.starting_date||null,
    judgement_procedure:draft.judgement_procedure,
    judge:draft.judge||null,
    ok_comment:draft.judge==="OK"?draft.comment:null,
    imds_reject_comment:draft.judge==="NG"?draft.comment:null
   };
   const response=await fetch("/api/register/"+selected.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   const json=await response.json();
   if(!response.ok)throw new Error(json.error||"Could not save the judgement.");
   setMessage("Judgement and evaluation trace saved to the live register.");
   setSelectedId(null);router.refresh();
  }catch(cause){setError(cause instanceof Error?cause.message:"Save failed.");}
  finally{setBusy(false);}
 }

 const updated=sourceDate?new Date(sourceDate).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"}):null;
 const massTrace=massEvaluation?.evaluations?.[0]?.inputValue&&typeof massEvaluation.evaluations[0].inputValue==="object"?massEvaluation.evaluations[0].inputValue as Record<string,unknown>:null;
 const needsSupplier=massEvaluation?.recommendation==="MANUAL_REVIEW"&&massEvaluation?.ruleId==="RULE-07-MASS-TOLERANCE"&&String(massEvaluation.evaluations?.[0]?.branch||"").includes("SUPPLIER");

 return <div className="judgement-workspace">
  <header className="judgement-hero">
   <div><div className="judgement-eyebrow"><Sparkles size={13}/> IMDS / G-CATS · LIVE JUDGEMENT</div><h1>Judgement workspace</h1>
    <p>Work only on current-year cases. The pending queue excludes rows already judged; completed source records remain available in the Judged tab.</p>
   </div>
   <a className="judgement-switch" href="/workspace"><ArrowLeft size={14}/> Switch workspace</a>
  </header>
  <div className="judgement-source-bar"><div className="judgement-source-icon"><FileSpreadsheet size={16}/></div>
   <div><strong>{sourceFile||"Latest committed G-CATS snapshot"}</strong><span>{sourceSheet||"Current-year source records"}{updated?" · Updated "+updated:""}</span></div>
   <span className="source-scope">{year} · WORKING</span>
  </div>
  {queryError&&<div className="judgement-alert"><AlertCircle size={15}/>{queryError}</div>}
  {rows.length===0&&<div className="judgement-empty-source"><FileSpreadsheet size={25}/><strong>No current-year source records</strong><span>Commit the current G-CATS Master Data workbook from Daily G-CATS Update to populate the active queue.</span></div>}
  <section className="judgement-kpis">
   <button type="button" className="judgement-kpi" onClick={()=>setTab("pending")}><span>Need judgement</span><strong>{counts.pending.toLocaleString("en-US")}</strong><small>WORKING and no Judge yet</small></button>
   <button type="button" className="judgement-kpi" onClick={()=>setTab("judged")}><span>Already judged</span><strong>{counts.judged.toLocaleString("en-US")}</strong><small>Judge OK / NG recorded</small></button>
   <button type="button" className="judgement-kpi" onClick={()=>setTab("km")}><span>Awaiting KM review</span><strong>{counts.km.toLocaleString("en-US")}</strong><small>Judgement entered, KM pending</small></button>
   <div className="judgement-kpi judgement-kpi-neutral"><span>Active this year</span><strong>{rows.filter(r=>r.source_status==="WORKING").length.toLocaleString("en-US")}</strong><small>WORKING · Latest snapshot</small></div>
  </section>
  <section className="judgement-months">
   <div className="judgement-section-head"><div><h2>Monthly workload</h2><p>Current-year items from the latest committed snapshot.</p></div><span>{rows.length.toLocaleString("en-US")} current-year rows</span></div>
   <div className="judgement-month-grid">{months.map(month=><button type="button" key={month.key} className="judgement-month" onClick={()=>{setSearch("");setErrorType("All Error Types");setTab("pending");setMonthFilter(monthFilter===month.key?"All Months":month.key);}}><strong>{month.name}</strong><span>{month.pending} pending</span><small>{month.total} total · {month.judged} judged</small></button>)}</div>
   {!months.length&&<div className="judgement-month-empty">No monthly source data.</div>}
  </section>
  <section className="judgement-board">
   <div className="judgement-list-panel">
    <div className="judgement-section-head"><div><h2>Work queue</h2><p>Select a row once; work on it in the panel at the right.</p></div><span className="judgement-count">{visible.length}</span></div>
    <div className="judgement-tabs">
     <button type="button" className={tab==="pending"?"active":""} onClick={()=>setTab("pending")}>To judge <b>{counts.pending}</b></button>
     <button type="button" className={tab==="judged"?"active":""} onClick={()=>setTab("judged")}>Judged <b>{counts.judged}</b></button>
     <button type="button" className={tab==="km"?"active":""} onClick={()=>setTab("km")}>KM review <b>{counts.km}</b></button>
    </div>
    <div className="judgement-filters">
     <label><Search size={14}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Part no., supplier, source code..."/></label>
     <label className="judgement-type-filter"><Filter size={14}/><select value={errorType} onChange={event=>setErrorType(event.target.value)}>{types.map(type=><option key={type}>{type}</option>)}</select></label>
     <label className="judgement-month-filter"><select value={monthFilter} onChange={event=>setMonthFilter(event.target.value)}><option value="All Months">All months</option>{months.map(month=><option value={month.key} key={month.key}>{month.name}</option>)}</select></label>
    </div>
    <div className="judgement-row-list">
     {visible.map(row=><button type="button" key={row.id} onClick={()=>setSelectedId(row.id)} className={"judgement-row "+(selectedId===row.id?"selected":"")}>
      <span className="judgement-row-state">{row.judge?<Check size={14}/>:<Clock3 size={14}/>}</span>
      <span className="judgement-row-main"><strong>{row.delivery_part_no||"Part number missing"}</strong><span>{row.error_type_label} · {row.supplier_code||"Supplier —"}</span><small>{row.source_record_key}</small></span>
      <span className={"judgement-row-status "+(row.judge?"is-judged":"is-pending")}>{row.judge||"Pending"}</span><ArrowUpRight size={15}/>
     </button>)}
     {!visible.length&&<div className="judgement-list-empty"><CircleHelp size={20}/><strong>No matching records</strong><span>Change the Error Type, month or status filter.</span></div>}
    </div>
   </div>
   <aside className="judgement-detail-panel">
    {!selected&&<div className="judgement-detail-empty"><ClipboardCheck size={30}/><strong>Ready for your next judgement</strong><span>Choose a row from the queue. Its source data, rule checks and actions appear here.</span></div>}
    {selected&&<div className="judgement-detail-content">
     <div className="judgement-detail-heading"><div><span className="judgement-eyebrow">SELECTED CASE · {selected.source_record_key}</span><h2>{selected.delivery_part_no||"Part number missing"}</h2><p>{selected.error_type_label} · {selected.supplier_code||"Supplier —"}</p></div><button type="button" onClick={()=>setSelectedId(null)} aria-label="Close judgement panel">×</button></div>
     <div className="judgement-context-grid">
      <div><span>G-CATS status</span><strong>{selected.source_status||"—"}</strong></div>
      <div><span>Original Judge</span><strong>{selected.source_judge_label||"—"}</strong></div>
      <div><span>KM Judge</span><strong>{selected.km_judge||selected.source_km_judge_label||"Pending"}</strong></div>
      <div><span>Supplier</span><strong>{selected.supplier_code||"—"}</strong></div>
     </div>
     <a className="judgement-followup-action" href={"/follow-up?"+new URLSearchParams({itemId:selected.id,supplierCode:selected.supplier_code||"",partNo:selected.delivery_part_no||"",errorType:selected.error_type_label})}><Mail size={13}/> Request supplier follow-up <ArrowUpRight size={13}/></a>

     {massType(selected.error_type_label)&&<section className="judgement-mass-panel">
      <div className="judgement-mass-head"><div><span className="judgement-eyebrow"><Calculator size={12}/> TSZ2900G REV.9 · MASS TOLERANCE</span><h3>Source-driven mass check</h3></div><button type="button" className="judgement-mass-recheck" onClick={()=>void runMassCheck(selected,massForm)} disabled={massBusy}>{massBusy?<LoaderCircle size={13}/>:<Calculator size={13}/>} Calculate</button></div>
      <p className="judgement-mass-intro">Values are prefilled from the G-CATS master row. Verify against the source drawing; only correct the fields after checking the drawing.</p>
      <div className="judgement-mass-inputs">
       <label>IMDS mass (g)<input inputMode="decimal" value={massForm.imdsMass} onChange={event=>updateMass("imdsMass",event.target.value)} placeholder="Read from Master Data"/></label>
       <label>Drawing mass (g)<input inputMode="decimal" value={massForm.drawingMass} onChange={event=>updateMass("drawingMass",event.target.value)} placeholder="Read from drawing"/></label>
       <label>Mass tolerance class<select value={massForm.toleranceClass} onChange={event=>updateMass("toleranceClass",event.target.value)}><option value="">Select class from drawing…</option>{allowedClasses.map(value=><option key={value}>{value}</option>)}</select></label>
      </div>
      <div className="judgement-drawing-source"><span>Drawing references</span><strong>{[sourceText(selected,"Drawing Info\nDrawing",37),sourceText(selected,"Drawing Info\nDrawing(2D)",38),sourceText(selected,"Drawing Info\nDrawing(3D)",39)].filter(Boolean).join(" · ")||"Not recorded in source row"}</strong></div>
      {massError&&<div className="judgement-feedback error"><AlertTriangle size={13}/>{massError}</div>}
      {massBusy&&!massEvaluation&&<div className="judgement-mass-loading"><LoaderCircle size={14}/> Calculating source tolerance bands…</div>}
      {massEvaluation&&<div className="judgement-mass-result">
       <div className="judgement-mass-result-head"><div><span>Rule recommendation</span><strong>{massEvaluation.recommendation.replaceAll("_"," ")}</strong></div><span className={"judgement-mass-badge "+(massEvaluation.recommendation==="RECOMMEND_OK"?"is-ok":massEvaluation.recommendation==="RECOMMEND_NG"?"is-ng":"is-hold")}>{massEvaluation.ruleStatus.replaceAll("_"," ")}</span></div>
       <p>{massEvaluation.reason}</p>
       {massTrace&&"min" in massTrace&&<div className="judgement-mass-bands">
        <div><span>TSZ Min</span><strong>{numberText(massTrace.min)} g</strong></div>
        <div><span>TSZ Max</span><strong>{numberText(massTrace.max)} g</strong></div>
        <div><span>Min −10%</span><strong>{numberText(massTrace.bufferMin)} g</strong></div>
        <div><span>Max +10%</span><strong>{numberText(massTrace.bufferMax)} g</strong></div>
        <div><span>Class / Tolerance</span><strong>{String(massTrace.toleranceClass)} / ±{numberText(massTrace.tolerance)} g</strong></div>
        <div><span>Source table row</span><strong>{String(massTrace.tableRow||"—")} · {String(massTrace.revision||"")}</strong></div>
       </div>}
       {needsSupplier&&<div className="judgement-supplier-response"><strong>Outside the ±10% buffer — supplier confirmation required</strong><span>Choose the supplier's actual response after it is received.</span><div>
        <button type="button" className={massForm.supplierConfirmation==="ACTUAL_OR_CALCULATED_MASS"?"selected":""} onClick={()=>updateMass("supplierConfirmation","ACTUAL_OR_CALCULATED_MASS")}>A · Actual / calculated mass</button>
        <button type="button" className={massForm.supplierConfirmation==="INPUT_MISTAKE"?"selected":""} onClick={()=>updateMass("supplierConfirmation","INPUT_MISTAKE")}>B · Input mistake</button>
       </div>
       {massForm.supplierConfirmation&&<button type="button" className="judgement-mass-recheck" onClick={()=>void runMassCheck(selected,massForm)} disabled={massBusy}>Evaluate supplier response</button>}
       </div>}
       <div className="judgement-mass-actions">
        {massEvaluation.recommendation.startsWith("RECOMMEND_")&&<button type="button" onClick={applyMassRecommendation}><Check size={13}/> Apply recommendation to Judge / comment</button>}
        {massEvaluation.recommendation==="MANUAL_REVIEW"&&<a href={"/follow-up?"+new URLSearchParams({itemId:selected.id,supplierCode:selected.supplier_code||"",partNo:selected.delivery_part_no||"",errorType:selected.error_type_label})}><Mail size={13}/> Prepare supplier A/B confirmation</a>}
       </div>
      </div>}
      <small className="judgement-mass-footnote">The ±10% envelope follows the source workbook formula: Min × 0.9 and Max × 1.1. This is a recommendation only; Judge and KM approval remain human-controlled.</small>
     </section>}

     {canEdit?<><div className="judgement-form-grid">
      <label>Assigned person<input value={draft.assigned_person} onChange={event=>setDraft(old=>({...old,assigned_person:event.target.value}))} placeholder="Responsible person"/></label>
      <label>Starting date<input type="date" value={draft.starting_date} onChange={event=>setDraft(old=>({...old,starting_date:event.target.value}))}/></label>
      <label className="wide">Judgement procedure<textarea rows={3} value={draft.judgement_procedure} onChange={event=>setDraft(old=>({...old,judgement_procedure:event.target.value}))} placeholder="The system adds the calculated basis here; record any further evidence..."/></label>
      <label>Judge<select value={draft.judge} onChange={event=>setDraft(old=>({...old,judge:event.target.value,comment:""}))}><option value="">Pending</option><option value="OK">OK</option><option value="NG">NG</option></select></label>
      {draft.judge&&<label className="wide">{draft.judge==="OK"?"Record of changing to OK":"IMDS Reject comment"}<textarea rows={2} value={draft.comment} onChange={event=>setDraft(old=>({...old,comment:event.target.value}))} placeholder={draft.judge==="OK"?"Required OK evidence / comment":"Required rejection reason"}/></label>}
     </div>
     {error&&<div className="judgement-feedback error">{error}</div>}
     {message&&<div className="judgement-feedback success"><Check size={13}/>{message}</div>}
     <button type="button" className="judgement-save" onClick={save} disabled={busy||(draft.judge!==""&&!draft.comment.trim())}>{busy?<LoaderCircle size={14}/>:<ShieldCheck size={14}/>} Save judgement</button>
     </>:<div className="judgement-readonly"><ShieldCheck size={15}/> Your role is read-only for judgement updates.</div>}
    </div>}
   </aside>
  </section>
  <p className="judgement-governance"><ShieldCheck size={13}/> Saving writes to the live operational register, records the evaluation trace and preserves the audit log. Automated checks never finalize a case without an authorized human decision.</p>
 </div>;
}
