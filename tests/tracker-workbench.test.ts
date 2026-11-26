import { describe,it,expect } from "vitest";
import { toWorkbenchRows, communicationState, dateOnly } from "@/lib/imds-master/workbench";
import { countRows,groupRows } from "@/lib/imds-master/workbench-metrics";
describe("Tracker workbench read model",()=>{
 const rows=toWorkbenchRows([{id:"1",company_name:"Fixture A",vendor_code:"001",project:"M1",imds_status:"not submitted",submission_plan:"2026-01-01",supplier_promise_date:"2026-01-02"},{id:"2",company_name:"Fixture A",vendor_code:"002",project:"M1",imds_status:"accepted",submission_plan:"2026-01-01"},{id:"3",company_name:"Fixture B",project:"M2",imds_status:"unknown"}],{},"2026-01-03");
 it("keeps distinct vendor identities",()=>expect(groupRows(rows,"supplier")).toHaveLength(3));
 it("counts only supplier action as overdue",()=>expect(countRows(rows)).toMatchObject({total:3,missing:1,complete:1,review:1,overdue:1,missedPromise:1}));
 it("does not invent a date",()=>expect(dateOnly("2026-02-31")).toBeNull());
 it("labels handoff and unknown correctly",()=>{expect(communicationState("SENT",{httpStatus:202})).toBe("HANDED_OFF");expect(communicationState("FAILED",{httpStatus:0})).toBe("UNKNOWN");expect(communicationState("SENT",null)).toBe("LEGACY_SENT_UNVERIFIED")});
});
