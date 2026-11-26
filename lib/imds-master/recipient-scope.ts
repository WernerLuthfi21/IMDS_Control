import { emailsOf } from "@/lib/followup/recipients";
import { resolveContacts, nameKey, type Directory } from "@/lib/followup/directory";
const codeKey=(s:unknown)=>String(s??"").trim().toUpperCase().replace(/\.0$/,"");
const emailKey=(s:string)=>s.trim().toLowerCase();
export type ContactRow={supplier_code?:string|null;supplier_name?:string|null;email?:string|null;contact_role?:string|null};
/** Only exact unique vendor identity or exact unique name with no conflicting code. No fuzzy auto-send. */
export function exactSupplierDirectory(dir:Directory,company:string,code:string):Directory{
 const entries=Object.entries(dir.entries||{}),c=codeKey(code),n=nameKey(company);
 const byCode=c?entries.filter(([,e])=>codeKey(e.code)===c):[];
 if(byCode.length>1)return {};
 const byName=entries.filter(([,e])=>nameKey(e.name)===n&&(!c||!codeKey(e.code)||codeKey(e.code)===c));
 const hit=byCode.length===1?byCode[0]:byName.length===1?byName[0]:null;
 return hit?{entries:{[nameKey(company)]:hit[1]},buyers:dir.buyers}:{};
}
export function allowedSupplierEmails(input:{dir:Directory;company:string;code:string;masterEmails:string[];contacts:ContactRow[];fallbackMid:boolean}){
 const exact=exactSupplierDirectory(input.dir,input.company,input.code);
 const resolved=resolveContacts(exact,input.company,{vendorCode:input.code,fallbackMid:input.fallbackMid});
 const c=codeKey(input.code),n=nameKey(input.company);
 const contacts=input.contacts.filter(r=>{const rc=codeKey(r.supplier_code);return c&&rc?c===rc:nameKey(r.supplier_name)===n;});
 const pic=contacts.filter(r=>String(r.contact_role||"").toUpperCase()==="PIC").flatMap(r=>emailsOf(r.email||""));
 const to=new Set([...resolved.to,...pic,...input.masterEmails.flatMap(emailsOf)].map(emailKey));
 const cc=new Set([...to,...resolved.ccAlways,...resolved.mid,...resolved.top,...resolved.dir,...(resolved.buyer?.emails||[]),...contacts.flatMap(r=>emailsOf(r.email||""))].map(emailKey));
 return {to,cc};
}
export function verifyRecipients(to:string[],cc:string[],allowed:{to:Set<string>;cc:Set<string>},internal:string[],required:string[]):string|null{
 const internalSet=new Set(internal.map(emailKey)), domains=new Set([...internalSet].map(s=>s.split("@")[1]).filter(Boolean)),requiredSet=new Set(required.map(emailKey));
 if(!to.length||to.some(x=>!allowed.to.has(emailKey(x))))return "A To recipient is not verified for this supplier. Review the Directory.";
 if(cc.some(x=>{const key=emailKey(x);return !allowed.cc.has(key)&&!requiredSet.has(key)&&!internalSet.has(key)&&!domains.has(key.split("@")[1]);}))return "A CC recipient is not registered for this supplier or the internal team.";
 return null;
}
