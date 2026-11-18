"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Moon, Search } from "lucide-react";

export type PaletteItem = { id: string; label: string; hint?: string; group: string; keywords?: string; run: () => void };

/**
 * Ctrl/Cmd + K command palette: jump to any module, search a part number / CAS / supplier in the
 * register, switch theme. A real dialog: focus moves into it, ↑ ↓ move, Enter runs, Esc closes and
 * focus returns to where it was.
 */
export function CommandPalette({ items, onTheme }: { items: Array<Omit<PaletteItem, "run"> & { href?: string }>; onTheme: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("imds:palette", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("imds:palette", onOpen); };
  }, []);
  useEffect(() => {
    if (open) { back.current = document.activeElement as HTMLElement | null; window.setTimeout(() => input.current?.focus(), 0); }
    else back.current?.focus?.();
  }, [open]);

  const close = () => { setOpen(false); setQ(""); setAt(0); };
  const all: PaletteItem[] = useMemo(() => [
    ...items.map((i) => ({ ...i, run: () => { if (i.href) router.push(i.href); } })),
    { id: "theme", label: "Switch light / dark theme", group: "Actions", keywords: "dark light mode", run: onTheme }
  ], [items, router, onTheme]);
  const term = q.trim().toLowerCase();
  const list = useMemo(() => {
    const hit = all.filter((i) => !term || (i.label + " " + (i.keywords || "") + " " + i.group).toLowerCase().includes(term));
    if (term) hit.push({ id: "search", label: `Search “${q.trim()}” in the Judgement register`, hint: "part no. · supplier · CAS · substance", group: "Search", run: () => router.push(`/judgement?q=${encodeURIComponent(q.trim())}`) });
    return hit;
  }, [all, term, q, router]);
  const pos = Math.min(at, Math.max(0, list.length - 1));
  if (!open) return null;

  const run = (i: PaletteItem | undefined) => { if (!i) return; close(); i.run(); };
  let lastGroup = "";
  return <div className="cp-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div className="cp" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="cp-input"><Search size={16} aria-hidden="true"/>
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }} placeholder="Jump to a module, or type a part no. / CAS…"
          role="combobox" aria-expanded="true" aria-controls="cp-list" aria-activedescendant={list[pos] ? "cp-" + list[pos].id : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAt((pos + 1) % Math.max(1, list.length)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt((pos - 1 + list.length) % Math.max(1, list.length)); }
            else if (e.key === "Enter") { e.preventDefault(); run(list[pos]); }
            else if (e.key === "Escape") { e.preventDefault(); close(); }
            else if (e.key === "Tab") e.preventDefault();
          }}/>
        <kbd>Esc</kbd>
      </div>
      <ul className="cp-list" id="cp-list" role="listbox" aria-label="Results">
        {list.map((i, n) => {
          const head = i.group !== lastGroup ? (lastGroup = i.group) : null;
          return <li key={i.id} role="presentation">
            {head && <div className="cp-group" role="presentation">{head}</div>}
            <div id={"cp-" + i.id} role="option" aria-selected={n === pos} className={"cp-item" + (n === pos ? " on" : "")}
              onMouseEnter={() => setAt(n)} onMouseDown={(e) => { e.preventDefault(); run(i); }}>
              {i.id === "theme" ? <Moon size={14} aria-hidden="true"/> : null}<span>{i.label}</span>{i.hint && <small>{i.hint}</small>}{n === pos && <CornerDownLeft size={13} aria-hidden="true"/>}
            </div>
          </li>;
        })}
        {!list.length && <li className="cp-empty" role="presentation">Nothing matches.</li>}
      </ul>
      <div className="cp-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>K</kbd> toggle</span></div>
    </div>
  </div>;
}
