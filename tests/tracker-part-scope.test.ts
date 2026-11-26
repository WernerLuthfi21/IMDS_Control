import { describe, expect, it } from "vitest";
import { verifyTrackerPartScope } from "@/lib/imds-master/part-scope";
const input = { idsCount: 1, parts: [{ company_name: "Fixture Supplier", vendor_code: "001" }], supplierName: "fixture supplier", supplierCode: "001", recap: false, requireParts: true };
describe("Tracker supplier attachment scope", () => {
  it("accepts exactly the matching supplier", () => expect(verifyTrackerPartScope(input)).toBeNull());
  it("blocks cross-supplier attachments", () => expect(verifyTrackerPartScope({...input, supplierName:"Other Supplier"})).toMatch(/different supplier/));
  it("blocks conflicting vendor codes", () => expect(verifyTrackerPartScope({...input, supplierCode:"002"})).toMatch(/vendor codes/));
  it("blocks missing parts", () => expect(verifyTrackerPartScope({...input, parts:[]})).toMatch(/missing/));
  it("blocks an empty live selection", () => expect(verifyTrackerPartScope({...input, idsCount:0,parts:[]})).toMatch(/at least one/));
  it("preserves a test with no parts", () => expect(verifyTrackerPartScope({...input, idsCount:0,parts:[],requireParts:false})).toBeNull());
});
