"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, ClipboardCheck, FileSearch, LoaderCircle, Play, ShieldAlert } from "lucide-react";

type Eval = {nodeId:string;question:string;inputValue:unknown;branch:string;result:string;source:string;sourcePage?:number;comment?:string;explanation:string};
type Result = {errorType:string|number;ruleId:string;ruleStatus:string;recommendation:string;finalDecision:string;comment?:string;reason:string;evaluations:Eval[];manualTasks:string[];sourceReferences:string[];isDemo:boolean};
const choices = [
  {value:"6",label:"No. 6 · SMS Mass"},{value:"7",label:"No. 7 · Mass tolerance range"},{value:"8",label:"No. 8 · Mass deviation"},{value:"9",label:"No. 9 · Not specific substance"},{value:"10",label:"No. 10 · ELV (Pb)"},{value:"11",label:"No. 11 · ELV (Cd)"},{value:"12",label:"No. 12 · ELV (Hg)"},{value:"13",label:"No. 13 · ELV (Cr6+)"},{value:"14",label:"No. 14 · Prohibited substance"},{value:"19",label:"No. 19 · Type 19 source conflict"},{value:"20",label:"No. 20 · Supplied is not SMS"},{value:"21",label:"No. 21 · WARP Part number"},{value:"22",label:"No. 22 · Y Part number"},{value:"23",label:"No. 23 · Area Code/Supplier Code"},{value:"24",label:"No. 24 · Application44ERROR (was 19 in Appendix I)"}
];
const baseFields = [
  {name:"supplierConfirmation",label:"Supplier confirmation",kind:"select",options:["","ACTUAL_OR_CALCULATED_MASS","INPUT_MISTAKE","SUPPLIER_CONFIRMED","OTHER"]},
  {name:"imdsMass",label:"IMDS mass (g)",kind:"number"},{name:"drawingMass",label:"Drawing mass (g)",kind:"number"},{name:"toleranceClass",label:"Tolerance class",kind:"select",options:["","MA","MB","MC","MD","ME","MF"]},
  {name:"isRawMaterial",label:"Raw material?",kind:"boolean"},{name:"drawingHeavierThanReference",label:"Drawing heavier than referenced mass?",kind:"boolean"},
  {name:"componentPartMass",label:"Component part mass (g)",kind:"number"},{name:"totalMaterialMass",label:"Total material mass (g)",kind:"number"},{name:"approvedDeviationPercent",label:"Approved deviation percentage (%)",kind:"number"},
  {name:"isToyotaSuppliedPart",label:"Toyota supplied part?",kind:"boolean"},{name:"isImdsCommitteeMaterial",label:"IMDS Committee / Stahl und Eisen / ILI-Metals?",kind:"boolean"},{name:"wildcardPercentage",label:"Total not-specified substance (%)",kind:"number"},{name:"isMultiMaterial",label:"Multi-material?",kind:"boolean"},{name:"baseMaterialWildcardPercentage",label:"Base-material not-specified (%)",kind:"number"},
  {name:"applicationId",label:"Application ID",kind:"text"},{name:"destination",label:"Verified destination",kind:"text"},{name:"policyOutcome",label:"Pb policy table outcome",kind:"select",options:["","OK","NG","UNKNOWN"]},{name:"approvedApplication71",label:"Application 71 evidence approved?",kind:"boolean"},
  {name:"sourceNote",label:"Source evidence note",kind:"text"}
] as const;

export function JudgementStudio() {
  const [errorType,setErrorType] = useState("6");
  const [sourceCatalog,setSourceCatalog] = useState("none");
  const [values,setValues] = useState<Record<string,string>>({});
  const [result,setResult] = useState<Result|null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const visibleFields = useMemo(()=>{
    const n=Number(errorType);
    if(n===6) return baseFields.filter(f=>f.name==="supplierConfirmation");
    if(n===7) return baseFields.filter(f=>["imdsMass","drawingMass","toleranceClass","isRawMaterial","drawingHeavierThanReference","supplierConfirmation"].includes(f.name));
    if(n===8) return baseFields.filter(f=>["componentPartMass","totalMaterialMass","approvedDeviationPercent"].includes(f.name));
    if(n===9) return baseFields.filter(f=>["isToyotaSuppliedPart","isImdsCommitteeMaterial","wildcardPercentage","isMultiMaterial","baseMaterialWildcardPercentage"].includes(f.name));
    if(n===10) return baseFields.filter(f=>["applicationId","destination","policyOutcome","approvedApplication71","sourceNote"].includes(f.name));
    return baseFields.filter(f=>f.name==="sourceNote");
  },[errorType]);
  function setValue(name:string,value:string){setValues(prev=>({...prev,[name]:value}));}
  async function run(e:React.FormEvent){
    e.preventDefault();setLoading(true);setError("");setResult(null);
    const payload:Record<string,unknown>={errorType:Number(errorType),sourceCatalog};
    visibleFields.forEach(f=>{
      const v=values[f.name];
      if(v===undefined||v==="")return;
      if(f.kind==="number") payload[f.name]=Number(v);
      else if(f.kind==="boolean") payload[f.name]=v==="true";
      else payload[f.name]=v;
    });
    try {const response=await fetch("/api/judgement/evaluate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const json=await response.json();if(!response.ok)throw new Error(json.error||"Judgement evaluation failed.");setResult(json.result as Result);}catch(err){setError(err instanceof Error?err.message:"Unable to evaluate the case.");}finally{setLoading(false);}
  }
  return <div className="two-col">
    <section className="panel">
      <div className="panel-header"><div><div className="panel-title">Judgement input</div><div className="panel-subtitle">Enter source values and known confirmation evidence.</div></div><span className="pill">RULE ENGINE V0.1</span></div>
      <form className="panel-body" onSubmit={run}>
        <div className="form-grid">
          <div className="form-field"><label>Error Type</label><select className="select-field" value={errorType} onChange={e=>{setErrorType(e.target.value);setResult(null);}}>{choices.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></div>
          {errorType==="19"&&<div className="form-field"><label>Source catalogue context</label><select className="select-field" value={sourceCatalog} onChange={e=>setSourceCatalog(e.target.value)}><option value="none">Not reconciled / no owner decision</option><option value="appendix_judgement_criteria">Appendix I detailed judgement criteria</option><option value="system_error_check">Section II system error list</option></select><span className="form-hint">Type 19 differs by section; the numeric Type 19 remains on HOLD until owner reconciliation; this selector is contextual only.</span></div>}
          {visibleFields.map(f=><div className="form-field" key={f.name}><label>{f.label}</label>{f.kind==="select"?<select className="select-field" value={values[f.name]||""} onChange={e=>setValue(f.name,e.target.value)}>{f.options.map(o=><option value={o} key={o}>{o?o.replaceAll("_"," "):"Select..."}</option>)}</select>:f.kind==="boolean"?<select className="select-field" value={values[f.name]||""} onChange={e=>setValue(f.name,e.target.value)}><option value="">Unknown / not verified</option><option value="true">Yes</option><option value="false">No</option></select>:<input className="field" type={f.kind==="number"?"number":"text"} step="any" value={values[f.name]||""} onChange={e=>setValue(f.name,e.target.value)} placeholder={f.kind==="number"?"Enter source value":"Enter evidence / reference"}/>}</div>)}
        </div>
        <div className="callout callout-info" style={{marginTop:14}}><ShieldAlert size={15}/><span>Evaluation generates a <strong>recommendation only</strong>. Missing source values route to manual review or HOLD. Final OK/NG requires a separate authorized approval.</span></div>
        {error&&<div className="callout callout-danger" style={{marginTop:12}}><AlertTriangle size={15}/>{error}</div>}
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:15}}><button className="btn btn-primary" type="submit" disabled={loading}>{loading?<LoaderCircle size={14} className="spin"/>:<Play size={13}/>} Run deterministic check</button></div>
      </form>
    </section>
    <section className="panel">
      <div className="panel-header"><div><div className="panel-title">Evaluation trace</div><div className="panel-subtitle">Branch-by-branch explanation and source attribution.</div></div><ClipboardCheck size={16} color="#67839a"/></div>
      <div className="panel-body">
        {!result&&!loading&&<div className="empty-state"><FileSearch size={26}/><strong>No evaluation executed</strong><span>Select an Error Type and provide the available source evidence to see the decision path.</span></div>}
        {loading&&<div className="empty-state"><LoaderCircle size={24} className="spin"/><strong>Evaluating rule</strong><span>Running deterministic checks against the current source-supported branches.</span></div>}
        {result&&<>
          <div className="result-heading"><span className="eyebrow" style={{margin:0}}>RECOMMENDATION</span><span className={`status ${result.recommendation.includes("OK")?"status-green":result.recommendation.includes("NG")?"status-red":result.recommendation==="HOLD"?"status-red":"status-amber"}`}><span className="status-dot"/>{result.recommendation}</span></div>
          <div className="rule-name" style={{marginTop:10}}>{result.ruleId}</div><div className="result-body">{result.reason}</div>
          <div className="divider"/>
          <div className="eyebrow">DECISION TRACE</div>
          {result.evaluations.map(ev=><div className="result-card" key={ev.nodeId}><div className="result-heading"><strong style={{fontSize:10,color:"var(--ink)"}}>{ev.nodeId} · {ev.question}</strong><span className={`status ${ev.result.includes("OK")?"status-green":ev.result.includes("NG")?"status-red":"status-amber"}`}>{ev.result}</span></div><div className="result-body"><strong>Input:</strong> {typeof ev.inputValue==="object"?JSON.stringify(ev.inputValue):String(ev.inputValue??"Not provided")}<br/><strong>Branch:</strong> {ev.branch}<br/>{ev.explanation}</div><div className="rule-meta"><span className="meta-chip">{ev.source}{ev.sourcePage?` · p.${ev.sourcePage}`:""}</span></div>{ev.comment&&<div className="callout callout-info" style={{marginTop:9}}>Suggested comment: <strong>{ev.comment}</strong></div>}</div>)}
          {result.manualTasks.length>0&&<><div className="divider"/><div className="eyebrow">REQUIRED MANUAL TASKS</div><ul className="result-list">{result.manualTasks.map(x=><li key={x}>{x}</li>)}</ul></>}
          <div className="divider"/><div className="result-heading"><span className="eyebrow" style={{margin:0}}>FINAL G-CATS DECISION</span><span className="status status-gray">{result.finalDecision}</span></div><div className="form-hint" style={{marginTop:7}}>This evaluator has not changed a final decision or sent data to G-CATS.</div>
        </>}
      </div>
    </section>
  </div>;
}
