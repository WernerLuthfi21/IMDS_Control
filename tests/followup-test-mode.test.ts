import { describe, expect, it } from "vitest";
import { parseSenders } from "@/lib/followup/payload";
import { mergeCc } from "@/lib/followup/center";

describe("follow-up test mode building blocks", () => {
  it("parses the sender allow-list used to authorise test domains", () => {
    const s = parseSenders("Aiko <aiko@toyota.co.id>; Ayu <ayu@toyota.co.id>");
    expect(s.map((x) => x.email)).toEqual(["aiko@toyota.co.id", "ayu@toyota.co.id"]);
  });
  it("live sends keep the mandatory CC (test sends skip mergeCc on the server)", () => {
    const cc = mergeCc({ to: ["pic@sup.co.id"], cc: [], required: ["fuad-qc@toyota.co.id"], senderEmail: undefined });
    expect(cc).toContain("fuad-qc@toyota.co.id");
  });
});
