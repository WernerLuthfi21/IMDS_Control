// Turns raw upload / database errors into one sentence that says what happened and what to do. Pure, unit-tested.

export const ROLE_LOOP_MIGRATION = "supabase/migrations/20261119030000_role_helpers_no_rls_recursion.sql";

export function friendlyImportError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? "");
  const name = raw instanceof Error ? raw.name : "";
  if (/54001|stack depth limit/i.test(msg)) {
    return `The database role check went into a loop for this account (error 54001), so nothing was imported. An admin runs ${ROLE_LOOP_MIGRATION} once in the Supabase SQL Editor; after that it works for every account.`;
  }
  if (name === "NotReadableError" || /could not be read|NotReadableError|permission problems/i.test(msg)) {
    return "Windows could not read the file. If it lives in a OneDrive / SharePoint folder, right-click it → “Always keep on this device” (or close it in Excel), then drop it again.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return "The connection dropped before the file arrived. Check the internet connection and drop the file again; nothing was imported.";
  if (/preparer or admin role/i.test(msg)) return "Your account can view but not import. Ask an admin to give you the Preparer role (Admin → Users).";
  if (/Authentication required/i.test(msg)) return "Your session ended. Sign in again, then drop the file again.";
  return msg || "The import failed.";
}
