"use client";
import { useId, useRef, useState } from "react";
import { AlertTriangle, FileCheck2, UploadCloud, X } from "lucide-react";

/**
 * One drop zone for every file upload in the app: drag a file in, or click / press Enter to browse.
 * Checks the extension and size before the file reaches the page, so a wrong file never starts an
 * import, and stops the browser from opening a dropped file instead of uploading it.
 */
export function DropZone({ accept, maxMB = 20, multiple = false, files, onFiles, onClear, title, hint, disabled = false, compact = false, label }: {
  /** Allowed extensions, e.g. [".xlsx", ".csv"]. */
  accept: string[];
  maxMB?: number;
  multiple?: boolean;
  /** What is selected now (shown in the zone). */
  files: File[];
  onFiles: (files: File[]) => void;
  onClear?: () => void;
  title: string;
  hint?: string;
  disabled?: boolean;
  compact?: boolean;
  /** Accessible name; defaults to the title. */
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");
  const hintId = useId();

  function take(list: FileList | File[] | null | undefined) {
    const all = Array.from(list || []);
    if (!all.length) return;
    const picked = multiple ? all : all.slice(0, 1);
    const bad = !accept.length ? [] : picked.filter((f) => !accept.some((ext) => f.name.toLowerCase().endsWith(ext.toLowerCase())));
    const big = picked.filter((f) => f.size > maxMB * 1024 * 1024);
    if (bad.length) { setError(`${bad[0].name} is not ${accept.join(" / ")}.`); return; }
    if (big.length) { setError(`${big[0].name} is ${(big[0].size / 1048576).toFixed(1)} MB — the limit is ${maxMB} MB.`); return; }
    if (!multiple && all.length > 1) setError(`Only one file at a time — ${picked[0].name} was taken.`); else setError("");
    onFiles(picked);
  }
  const browse = () => { if (!disabled) input.current?.click(); };
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types || []).includes("Files");

  return <div data-dropzone="" role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={label || title} aria-describedby={hintId}
    className={"dz" + (over ? " over" : "") + (files.length ? " has" : "") + (error ? " err" : "") + (compact ? " compact" : "") + (disabled ? " off" : "")}
    onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; browse(); }}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); browse(); } }}
    onDragEnter={(e) => { if (!hasFiles(e) || disabled) return; e.preventDefault(); depth.current++; setOver(true); }}
    onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
    onDragLeave={(e) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
    onDrop={(e) => { e.preventDefault(); depth.current = 0; setOver(false); if (!disabled) take(e.dataTransfer.files); }}>
    <input ref={input} type="file" hidden multiple={multiple} accept={accept.length ? accept.join(",") : undefined} disabled={disabled} tabIndex={-1}
      onChange={(e) => { take(e.target.files); e.target.value = ""; }}/>
    <span className="dz-ic" aria-hidden="true">{files.length ? <FileCheck2 size={compact ? 18 : 22}/> : <UploadCloud size={compact ? 18 : 22}/>}</span>
    <span className="dz-text">
      {files.length ? <>
        {files.map((f) => <strong key={f.name + f.size} className="dz-file" title={f.name}>{f.name}<small>{f.size < 102400 ? `${Math.max(1, Math.round(f.size / 1024))} KB` : `${(f.size / 1048576).toFixed(2)} MB`}</small></strong>)}
        <span id={hintId} className="dz-hint">Drop another file or click to replace</span>
      </> : <>
        <strong>{over ? "Release to add the file" : title}</strong>
        <span id={hintId} className="dz-hint">{hint || "or click to browse"} · {accept.length ? accept.join(" ") : "any file"} · max {maxMB} MB</span>
      </>}
      {error && <span className="dz-error" role="alert"><AlertTriangle size={13}/> {error}</span>}
    </span>
    {files.length > 0 && onClear && <button type="button" className="dz-clear" onClick={() => { setError(""); onClear(); }} aria-label="Remove the selected file"><X size={15}/></button>}
  </div>;
}
