import { describe, expect, it } from "vitest";
import { canAccessImdsTracker } from "@/lib/security/imds-tracker";

describe("canAccessImdsTracker", () => {
  it.each(["admin", "preparer", "reviewer", "rule_author", "rule_approver", "viewer"])(
    "allows the internal %s role",
    (role) => expect(canAccessImdsTracker(role)).toBe(true)
  );
  it.each(["supplier", "unknown", "", null, undefined])(
    "rejects non-internal role %s",
    (role) => expect(canAccessImdsTracker(role as string | null | undefined)).toBe(false)
  );
});
