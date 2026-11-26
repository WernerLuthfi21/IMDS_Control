"use client";
import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Copy, ChevronLeft, ChevronRight } from "lucide-react";
type Contact={id:string;supplier_code:string;supplier_name:string|null;contact_name:string|null;email:string};
const templates=[
 {name:"IMDS clarification",body:"Dear {{supplier}}, please check our email regarding IMDS clarification for part {{part}}. Kindly reply with your confirmation. Thank you."},
 {name:"Submission reminder",body:"Dear {{supplier}}, kindly review the IMDS submission reminder sent by email and confirm your expected completion date. Thank you."},
 {name:"General follow-up",body:"Dear {{supplier}}, kindly review our latest email regarding IMDS and confirm the next action. Thank you."}
];
function normalize(value:string){const v=value.trim().replace(/[\s().-]/g,"");const n=v.startsWith("0")?"62"+v.slice(1):v.replace(/^\+/,"");return /^[1-9]\d{7,14}$/.test(n)?n:"";}
export function WhatsAppDrafts({initial}:{initial?:{supplierCode?:string;partNo?:string;errorType?:string}}){
 const [contacts,setContacts]=useState<Contact[]>([]);
 const [supplier,setSupplier]=useState(initial?.supplierCode||"");
 const [part,setPart]=useState(initial?.partNo||"");
 const [phone,setPhone]=useState("");
 const [consent,setConsent]=useState(false);
 const [template,setTemplate]=useState(0);
 const [custom,setCustom]=useState<string|null>(null);
 const [notice,setNotice]=useState("");
 const [queue,setQueue]=useState<{phone:string;message:string}[]>([]);
 const [index,setIndex]=useState(0);
 useEffect(()=>{let active=true;fetch("/api/suppliers/contacts",{cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject()).then(j=>{if(active)setContacts(j.contacts||[])}).catch(()=>{if(active)setNotice("Supplier directory unavailable. You can still prepare a draft manually.")});return()=>{active=false}},[]);
 const suppliers=useMemo(()=>Array.from(new Map(contacts.map(c=>[c.supplier_code,c.supplier_name||c.supplier_code])).entries()).sort(([a],[b])=>a.localeCompare(b)),[contacts]);
 const text=custom??templates[template].body.replaceAll("{{supplier}}",suppliers.find(([key])=>key===supplier)?.[1]||supplier||"Supplier").replaceAll("{{part}}",part||"[part number]");
 const number=normalize(phone);
 const ready=!!number&&consent&&!!text.trim()&&!text.includes("[part number]");
 function add(){if(!ready)return;if(queue.some(q=>q.phone===number)){setNotice("This number is already in the session queue.");return;}setQueue(q=>[...q,{phone:number,message:text}]);setPhone("");setConsent(false);setNotice("Draft added. Nothing has been sent.");}
 const current=queue[index];
 return <section className="simple-card">
 <div className="simple-card-head"><div><h2>WhatsApp follow-up</h2><p>Free, human-reviewed drafts. Select your sending account in WhatsApp itself.</p></div><MessageCircle size={18}/></div>
 <div className="two-col"><div>
 <div className="form-grid">
 <div className="form-field"><label htmlFor="wa-supplier">Supplier</label><input id="wa-supplier" className="field" list="wa-suppliers" value={supplier} onChange={e=>{setSupplier(e.target.value);setConsent(false);setCustom(null)}}/><datalist id="wa-suppliers">{suppliers.map(([code,name])=><option key={code} value={code}>{name}</option>)}</datalist></div>
 <div className="form-field"><label htmlFor="wa-part">Part number</label><input id="wa-part" className="field" value={part} onChange={e=>{setPart(e.target.value);setCustom(null)}}/></div>
 <div className="form-field"><label htmlFor="wa-phone">Recipient WhatsApp number</label><input id="wa-phone" className="field" type="tel" value={phone} onChange={e=>{setPhone(e.target.value);setConsent(false)}} placeholder="+62 812…"/></div>
 <div className="form-field"><label htmlFor="wa-template">Message template</label><select id="wa-template" className="select-field" value={template} onChange={e=>{setTemplate(Number(e.target.value));setCustom(null)}}>{templates.map((t,i)=><option key={t.name} value={i}>{t.name}</option>)}</select></div>
 </div>
 <label style={{display:"block",margin:"12px 0"}}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Recipient has agreed to WhatsApp contact; content is approved for external sharing.</label>
 <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="btn" disabled={!ready} onClick={add}>Add to review queue</button>{ready&&<a className="btn btn-primary" href={"https://wa.me/"+number+"?text="+encodeURIComponent(text)} target="_blank" rel="noopener noreferrer">Open WhatsApp draft</a>}</div>
 </div><div className="form-field"><label htmlFor="wa-message">Message preview · editable</label><textarea id="wa-message" className="textarea-field" rows={6} value={text} onChange={e=>setCustom(e.target.value)}/><button className="btn" type="button" onClick={()=>setCustom(null)}>Reset template</button></div></div>
 <details style={{marginTop:14}} open={queue.length>0}><summary>Review queue · {queue.length} drafts</summary><p className="muted">Session only. Each draft must be opened and sent manually. No delivery status is inferred.</p>{current&&<><p>Draft {index+1} / {queue.length} · +{current.phone}</p><pre style={{whiteSpace:"pre-wrap",maxHeight:140,overflow:"auto"}}>{current.message}</pre><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="btn" disabled={index===0} onClick={()=>setIndex(i=>i-1)}><ChevronLeft size={14}/> Previous</button><a className="btn btn-primary" href={"https://wa.me/"+current.phone+"?text="+encodeURIComponent(current.message)} target="_blank" rel="noopener noreferrer">Open draft</a><button className="btn" disabled={index+1>=queue.length} onClick={()=>setIndex(i=>i+1)}>Next <ChevronRight size={14}/></button><button className="btn" onClick={()=>{setQueue(q=>q.filter((_,i)=>i!==index));setIndex(i=>Math.max(0,Math.min(i,queue.length-2)))}}>Remove</button><button className="btn" onClick={()=>void navigator.clipboard.writeText(current.message).then(()=>setNotice("Draft copied.")).catch(()=>setNotice("Clipboard unavailable."))}><Copy size={14}/> Copy</button></div></>}</details>
 {notice&&<p role="status" className="muted">{notice}</p>}
 </section>
}
