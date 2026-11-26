import type { PostResult } from "@/lib/automation/flow";
export type FlowOutcome = "HANDED_OFF" | "PROVIDER_ACCEPTED" | "FAILED" | "UNKNOWN";
export function flowOutcome(result: PostResult): FlowOutcome {
  if(result.ok)return result.handedOff||result.status===202?"HANDED_OFF":"PROVIDER_ACCEPTED";
  return result.status===0||result.status===408||result.status>=500?"UNKNOWN":"FAILED";
}
export type JobState = "DRAFT"|"APPROVED"|"QUEUED"|"PROCESSING"|"HANDED_OFF"|"PROVIDER_ACCEPTED"|"SENT"|"DELIVERED"|"READ"|"FAILED"|"UNKNOWN"|"CANCELLED"|"EXPIRED";
const transitions:Record<JobState,readonly JobState[]>={DRAFT:["APPROVED","CANCELLED","EXPIRED"],APPROVED:["QUEUED","CANCELLED","EXPIRED"],QUEUED:["PROCESSING","CANCELLED","EXPIRED"],PROCESSING:["HANDED_OFF","PROVIDER_ACCEPTED","FAILED","UNKNOWN"],HANDED_OFF:["SENT","DELIVERED","FAILED","UNKNOWN"],PROVIDER_ACCEPTED:["SENT","DELIVERED","FAILED","UNKNOWN"],SENT:["DELIVERED","READ","FAILED"],DELIVERED:["READ"],READ:[],FAILED:[],UNKNOWN:[],CANCELLED:[],EXPIRED:[]};
export function validTransition(from:JobState,to:JobState){return transitions[from].includes(to)}
/** An expired lease may have performed an external side effect. Never automatically requeue it. */
export function expiredLeaseState(state:JobState):JobState{return state==="PROCESSING"?"UNKNOWN":state}
