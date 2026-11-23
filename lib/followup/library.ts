// Standard attachments ("file library", settings key attachment_library): files the team uploads once, for example
// the IMDS Supplier Check Form template, and ticks per e-mail or per automation. They are attached exactly as
// uploaded — never opened, filled in or changed by the app.
export type LibraryFile = { id: string; name: string; contentType: string; size: number; base64: string; at: string; by: string; note?: string };
export type Library = { files: LibraryFile[] };

export const LIBRARY_MAX_FILE = 3 * 1024 * 1024;
export const LIBRARY_MAX_FILES = 12;
const OK_TYPES = /^(application\/(pdf|vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document|presentationml\.presentation)|vnd\.ms-excel|msword|zip)|image\/(png|jpeg)|text\/(plain|csv))$/;

export const safeName = (n: unknown) => String(n ?? "").replace(/[\r\n"\\/:*?<>|]+/g, "_").trim().slice(0, 120) || "file";

/** Keeps only well-formed files of the allowed types and sizes; bytes are kept exactly as given. */
export function sanitizeLibrary(v: unknown): Library {
  const src = v && typeof v === "object" && Array.isArray((v as Library).files) ? (v as Library).files : [];
  const seen = new Set<string>(), files: LibraryFile[] = [];
  for (const f of src.slice(0, LIBRARY_MAX_FILES)) {
    const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    const id = String(o.id ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
    const base64 = String(o.base64 ?? "").replace(/\s+/g, "");
    const contentType = String(o.contentType ?? "").toLowerCase();
    if (!id || seen.has(id) || !base64 || !/^[A-Za-z0-9+/]+=*$/.test(base64) || !OK_TYPES.test(contentType)) continue;
    const size = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
    if (size > LIBRARY_MAX_FILE) continue;
    seen.add(id);
    files.push({ id, name: safeName(o.name), contentType, size, base64, at: String(o.at ?? "").slice(0, 40), by: String(o.by ?? "").slice(0, 120), note: String(o.note ?? "").slice(0, 200) || undefined });
  }
  return { files };
}

/** The chosen files as e-mail attachments, in the order chosen; unknown ids are ignored. */
export function pickLibrary(lib: Library, ids: string[]): { name: string; contentType: string; contentBytes: string }[] {
  return ids.map((id) => lib.files.find((f) => f.id === id)).filter((f): f is LibraryFile => !!f).map((f) => ({ name: f.name, contentType: f.contentType, contentBytes: f.base64 }));
}
/** Same list without the bytes (what the page needs to show names and sizes). */
export const listLibrary = (lib: Library) => lib.files.map((f) => ({ id: f.id, name: f.name, contentType: f.contentType, size: f.size, at: f.at, by: f.by, note: f.note }));
