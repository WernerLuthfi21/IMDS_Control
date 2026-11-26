import {describe,it,expect} from "vitest";
import {allowedSupplierEmails,verifyRecipients,exactSupplierDirectory} from "@/lib/imds-master/recipient-scope";
const dir={entries:{ALPHA:{name:"Fixture Alpha",code:"1",f:{pic1_email:"pic@alpha.test",staff_email:"staff@alpha.test"}},BETA:{name:"Fixture Beta",code:"2",f:{pic1_email:"pic@beta.test"}}}};
const allowed=allowedSupplierEmails({dir,company:"Fixture Alpha",code:"1",masterEmails:["master@alpha.test"],contacts:[{supplier_code:"2",supplier_name:"Fixture Alpha",email:"wrong@beta.test",contact_role:"PIC"}],fallbackMid:true});
describe("Tracker recipient scope",()=>{
 it("accepts verified supplier and internal recipients",()=>expect(verifyRecipients(["pic@alpha.test"],["staff@alpha.test","buyer@internal.test"],allowed,["owner@internal.test"],[])).toBeNull());
 it("rejects another supplier",()=>expect(verifyRecipients(["pic@beta.test"],[],allowed,[],[])).toMatch(/not verified/));
 it("rejects forged CC",()=>expect(verifyRecipients(["master@alpha.test"],["wrong@beta.test"],allowed,[],[])).toMatch(/not registered/));
 it("does not select fuzzy names",()=>expect(exactSupplierDirectory(dir,"Fixture Alpha Components","")).toEqual({}));
 it("rejects ambiguous vendor code",()=>expect(exactSupplierDirectory({entries:{...dir.entries,DUP:{name:"Other",code:"1"}}},"Fixture Alpha","1")).toEqual({}));
});
