import { describe, expect, it } from "vitest";
import { validatePassword, allowedStaffDomain, cleanText, escapeLike, grantableRoles, normalizeEmail, validateSupplierRequest, validEmail } from "@/lib/access/validate";
import { sameOrigin } from "@/lib/security/request";
import { mailerConfig } from "@/lib/notify/mailer";

describe("access request validation", () => {
  it("accepts a clean supplier request and normalises it", () => {
    const r = validateSupplierRequest({ name: " Ana  Putri ", company: "PT Maju", email: " ANA@Maju.co.id ", supplierCode: "ab-12", password: "abcdefghi1", password2: "abcdefghi1" });
    expect(r).toEqual({ ok: true, value: { name: "Ana Putri", company: "PT Maju", email: "ana@maju.co.id", supplierCode: "AB-12", password: "abcdefghi1" } });
  });
  it.each([
    [{ name: "A", company: "PT", email: "a@b.co", supplierCode: "X1", password: "abcdefghi1", password2: "abcdefghi1" }],
    [{ name: "Ana", company: "", email: "a@b.co", supplierCode: "X1", password: "abcdefghi1", password2: "abcdefghi1" }],
    [{ name: "Ana", company: "PT Maju", email: "not-an-email", supplierCode: "X1", password: "abcdefghi1", password2: "abcdefghi1" }],
    [{ name: "Ana", company: "PT Maju", email: "a@b.co", supplierCode: "bad code!", password: "abcdefghi1", password2: "abcdefghi1" }],
    [{ name: "Ana", company: "PT Maju", email: "a@b.co", supplierCode: "", password: "abcdefghi1", password2: "abcdefghi1" }],
    [{ name: "Ana", company: "PT Maju", email: "a@b.co", supplierCode: "X1", password: "short1", password2: "short1" }],
    [{ name: "Ana", company: "PT Maju", email: "a@b.co", supplierCode: "X1", password: "abcdefghi1", password2: "different11" }],
  ])("rejects invalid input %#", (b) => { expect(validateSupplierRequest(b).ok).toBe(false); });
  it("password rules", () => {
    expect(validatePassword("abcdefghi1")).toBeNull(); expect(validatePassword("abcdefghij")).not.toBeNull(); expect(validatePassword("1234567890")).not.toBeNull(); expect(validatePassword("abcdefghi1", "x")).toBe("Passwords do not match.");
  });
  it("strips markup and control characters", () => { expect(cleanText("<b>Hi</b>\u0000 there", 50)).toBe("b Hi /b there"); });
  it("validates e-mails and escapes LIKE wildcards", () => {
    expect(validEmail("a@b.co")).toBe(true); expect(validEmail("a b@c.co")).toBe(false); expect(normalizeEmail(" X@Y.Com ")).toBe("x@y.com");
    expect(escapeLike("a_b%c")).toBe("a\\_b\\%c");
  });
  it("suppliers can only be granted the supplier role", () => {
    expect(grantableRoles("supplier")).toEqual(["supplier"]);
    expect(grantableRoles("tmmin")).not.toContain("supplier");
    expect(grantableRoles("password_help")).toEqual([]);
  });
  it("staff e-mail domain allow-list is enforced only when configured", () => {
    expect(allowedStaffDomain("a@x.com", undefined)).toBe(true);
    expect(allowedStaffDomain("a@tmmin.co.id", "@tmmin.co.id, toyota.co.id")).toBe(true);
    expect(allowedStaffDomain("a@gmail.com", "tmmin.co.id")).toBe(false);
  });
});

describe("request guards", () => {
  it("requires a matching Origin header", () => {
    expect(sameOrigin(new Headers({ origin: "https://app.example.com", host: "app.example.com" }))).toBe(true);
    expect(sameOrigin(new Headers({ origin: "https://evil.com", host: "app.example.com" }))).toBe(false);
    expect(sameOrigin(new Headers({ host: "app.example.com" }))).toBe(false);
  });
  it("mailer needs host, user and password", () => {
    expect(mailerConfig({})).toBeNull();
    expect(mailerConfig({ FLOW_SMTP_HOST: "h", FLOW_SMTP_USER: "u", FLOW_SMTP_PASS: "p" })?.port).toBe(465);
    expect(mailerConfig({ NOTIFY_SMTP_HOST: "n", NOTIFY_SMTP_USER: "u", NOTIFY_SMTP_PASS: "p", NOTIFY_SMTP_PORT: "587" })?.port).toBe(587);
  });
});
