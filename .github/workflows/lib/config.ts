export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export const appName = process.env.NEXT_PUBLIC_APP_NAME || "IMDS Intelligence Control Center";
export const maxImportFileMb = Number(process.env.MAX_IMPORT_FILE_MB || 20);
