"use client";
import { useState } from "react";
import { AlertCircle, Calculator, CheckCircle2, CircleHelp, LoaderCircle, ShieldCheck } from "lucide-react";

type EvaluationResult={
 recommendation:string;comment?:string;reason:string;ruleStatus:string;ruleId:string;
 manualTasks:string[];evaluations:Array<{nodeId:string;question:string;inputValue:unknown;branch:string;result:string;explanation:string}>;
};
const classes=["MA","MB","MC","MD","ME","MF"];
const fmt=(v:unknown)=>{if(v===undefined||v===null||v==="")return "—";const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat("en-US",{maximumFractionDigits:4}).format(n):String(v);};

export function SupplierMassToleranceSelfCheck({supplierCode}:{supplierCode:string|null}){
 const [imdsMass,setImdsMass]=useState("");
 const [drawingMass,setDrawingMass]=useState("");
 const [toleranceClass,setToleranceClass]=useState("");
 const [confirmation,setConfirmation]=useState("");
 const [result,setResult]=useState<EvaluationResult|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");

 async function evaluate(){
  setLoading(true);setError("");setResult(null);
  try{
   const body:Record<string,unknown>={errorType:7,imdsMass,drawingMass,toleranceClass,dryRun:true};
   if(confirmation)body.supplierConfirmation=confirmation;
   const response=await fetch("/api/judgement/evaluate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"});
   const json=await response.json();
   if(!response.ok)throw new Error(json.error||"Self-check could not be completed.");
   setResult(json.result as EvaluationResult);
  }catch(cause){setError(cause instanceof Error?cause.message:"Self-check failed.");}
  finally{setLoading(false);}
 }

 const trace=result?.evaluations?.[0]?.inputValue&&typeof result.evaluations[0].inputValue==="object"?result.evaluations[0].inputValue as Record<string,unknown>:null;
 const outside= result?.ruleId==="RULE-07-MASS-TOLERANCE" && result.recommendation==="MANUAL_REVIEW" && result.evaluations?.[0]?.branch==="SUPPLIER_CONFIRMATION_REQUIRED";

 return <section className="supplier-mass-selfcheck">
  <div className="supplier-mass-selfcheck-head"><div><span className="supplier-selfcheck-kicker"><Calculator size={13}/> BEFORE IMDS SUBMISSION</span><h2>Mass tolerance self-check</h2><p>Check your IMDS mass against the drawing mass and the TSZ2900 tolerance class before submitting.</p></div><span className="supplier-selfcheck-mark"><ShieldCheck size={17}/></span></div>
  <div className="supplier-selfcheck-owner"><span>Supplier account</span><strong>{supplierCode||"Supplier profile"}</strong><small>This tool only evaluates values you enter. It does not show other suppliers' G-CATS records.</small></div>
  <div className="supplier-selfcheck-fields">
   <label>IMDS mass (g)<input inputMode="decimal" value={imdsMass} onChange={e=>setImdsMass(e.target.value)} placeholder="e.g. 1325.02"/></label>
   <label>Drawing mass (g)<input inputMode="decimal" value={drawingMass} onChange={e=>setDrawingMass(e.target.value)} placeholder="e.g. 1430"/></label>
   <label>Mass tolerance class on drawing<select value={toleranceClass} onChange={e=>setToleranceClass(e.target.value)}><option value="">Select MA–MF</option>{classes.map(c=><option key={c}>{c}</option>)}</select></label>
  </div>
  <div className="supplier-selfcheck-action"><span>Reference: TSZ2900G (Rev.9) · tolerance is selected using the drawing mass range and class.</span><button type="button" onClick={()=>void evaluate()} disabled={loading||!imdsMass.trim()||!drawingMass.trim()||!toleranceClass}>{loading?<LoaderCircle size={14}/>:<Calculator size={14}/>} Check mass</button></div>
  {error&&<div className="supplier-selfcheck-error"><AlertCircle size={14}/>{error}</div>}
  {result&&<div className="supplier-selfcheck-result">
   <div className="supplier-selfcheck-result-title"><div><span>Self-check result</span><strong>{result.recommendation.replaceAll("_"," ")}</strong></div><span className={"supplier-selfcheck-state "+(result.recommendation==="RECOMMEND_OK"?"ok":result.recommendation==="RECOMMEND_NG"?"ng":"hold")}>{result.ruleStatus.replaceAll("_"," ")}</span></div>
   <p>{result.reason}</p>
   {trace&&"min" in trace&&<div className="supplier-selfcheck-bands">
    <div><span>TSZ Min</span><strong>{fmt(trace.min)} g</strong></div><div><span>TSZ Max</span><strong>{fmt(trace.max)} g</strong></div>
    <div><span>Min −10%</span><strong>{fmt(trace.bufferMin)} g</strong></div><div><span>Max +10%</span><strong>{fmt(trace.bufferMax)} g</strong></div>
    <div><span>Class / Tolerance</span><strong>{String(trace.toleranceClass)} / ±{fmt(trace.tolerance)} g</strong></div><div><span>TSZ row</span><strong>{String(trace.tableRow||"—")}</strong></div>
   </div>}
   {outside&&<div className="supplier-selfcheck-confirm"><strong>Outside the additional ±10% buffer</strong><span>Indicate which statement applies to your submitted mass. This response is a self-declaration and may be checked by Toyota.</span>
    <div><button type="button" className={confirmation==="ACTUAL_OR_CALCULATED_MASS"?"selected":""} onClick={()=>setConfirmation("ACTUAL_OR_CALCULATED_MASS")}>A · Actual / calculated mass</button><button type="button" className={confirmation==="INPUT_MISTAKE"?"selected":""} onClick={()=>setConfirmation("INPUT_MISTAKE")}>B · Input mistake</button></div>
    {confirmation&&<button type="button" className="supplier-selfcheck-recheck" onClick={()=>void evaluate()} disabled={loading}>Evaluate my response</button>}
   </div>}
   {result.comment&&<div className="supplier-selfcheck-comment"><CheckCircle2 size={14}/><span>Suggested record: <strong>{result.comment}</strong></span></div>}
   <small className="supplier-selfcheck-disclaimer"><CircleHelp size={13}/> This is a preliminary self-check, not a G-CATS approval or a final Toyota judgement. Confirm the drawing revision, mass data and evidence before submission.</small>
  </div>}
 </section>;
}
