import { describe,it,expect } from "vitest";
import {flowOutcome,validTransition,expiredLeaseState} from "@/lib/imds-master/communication-state";
describe("Tracker communication safety",()=>{
 it("does not call a 202 delivered",()=>expect(flowOutcome({ok:true,status:202})).toBe("HANDED_OFF"));
 it("does not infer delivery from 200",()=>expect(flowOutcome({ok:true,status:200})).toBe("PROVIDER_ACCEPTED"));
 it("marks ambiguous timeout and server failures unknown",()=>{for(const status of [0,408,500,503])expect(flowOutcome({ok:false,status})).toBe("UNKNOWN")});
 it("blocks unsafe state transitions",()=>{expect(validTransition("DRAFT","PROCESSING")).toBe(false);expect(validTransition("UNKNOWN","QUEUED")).toBe(false);expect(validTransition("DELIVERED","SENT")).toBe(false);expect(validTransition("QUEUED","PROCESSING")).toBe(true)});
 it("quarantines expired processing claims",()=>expect(expiredLeaseState("PROCESSING")).toBe("UNKNOWN"));
});
