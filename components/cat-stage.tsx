"use client";
import { useEffect, useRef, useState } from "react";
import { CatMascot, type CatMood } from "@/components/cat-mascot";

/**
 * Just Miko: breathes softly, eyes and head follow the pointer, a tap makes Miko hop and talk.
 * Static when the user prefers reduced motion.
 */
const LINES: Record<CatMood, string[]> = {
  idle: ["Meow! Shall I check the queue?", "Purr… ready when you are.", "Tap Preview and I'll sort them out."],
  thinking: ["Reading the rules…", "Checking every case…", "Hmm, comparing the flows…"],
  success: ["Done! Those were easy.", "Purr-fect.", "All saved, with the full trace."],
  alert: ["Some cases need a person.", "I left the tricky ones for you."],
  error: ["Oops, something went wrong.", "I couldn't reach the server."],
  empty: ["Nothing pending. Nap time!", "Queue is clear. Zzz…"],
  working: ["Saving…", "Working through the batch…"],
  waiting: ["Waiting on the supplier, Purchasing or TMC.", "Those cases need someone else first."],
  celebrate: ["Batch done!", "Every case in this run is handled."]
};

export function CatStage({ mood, size = 112 }: { mood: CatMood; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [say, setSay] = useState<string | null>(null);
  const [hop, setHop] = useState(0);
  const sayTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0, visible = false;
    // Follow the pointer only while Miko is on screen (no layout reads for a hidden cat).
    const io = typeof IntersectionObserver === "function" && ref.current
      ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 }) : null;
    if (io && ref.current) io.observe(ref.current); else visible = true;
    const onMove = (e: PointerEvent) => {
      const el = ref.current; if (!el || !visible || document.hidden) return;
      const r = el.getBoundingClientRect();
      const nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
      const ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setLook({ x: nx, y: ny }));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); io?.disconnect(); };
  }, []);
  useEffect(() => () => window.clearTimeout(sayTimer.current), []);

  function poke() {
    const lines = LINES[mood];
    setSay(lines[Math.floor(Math.random() * lines.length)]);
    setHop((n) => n + 1);
    window.clearTimeout(sayTimer.current);
    sayTimer.current = window.setTimeout(() => setSay(null), 2600);
  }

  return <div className="cat-stage" ref={ref} style={{ width: size, height: size }}>
    <button type="button" className={"cat-poke" + (hop ? " hop-" + (hop % 2) : "")} onClick={poke} aria-label={"Miko the auto-judge cat. " + LINES[mood][0]}>
      <CatMascot mood={mood} size={size} look={look}/>
    </button>
    {say && <span className="cat-say" role="status">{say}</span>}
  </div>;
}
