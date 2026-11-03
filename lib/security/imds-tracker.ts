const INTERNAL_WORKSPACE_ROLES = new Set([
  "admin", "preparer", "reviewer", "rule_author", "rule_approver", "viewer"
]);

export function canAccessImdsTracker(role: string | null | undefined): boolean {
  return typeof role === "string" && INTERNAL_WORKSPACE_ROLES.has(role);
}
