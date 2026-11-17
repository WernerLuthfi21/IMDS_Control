"use client";
import { useEffect, useRef, useState } from "react";
import { CatMascot, type CatMood } from "@/components/cat-mascot";

/**
 * Miko on green glass cubes, in pure CSS 3D (same technique as the Tracker hero; no 3D library).
 * The scene tilts with the pointer, Miko's eyes follow it, and a tap makes Miko hop and talk.
 * Static when the user prefers reduced motion.
 */
const LINES: Record<CatMood, string[]> = {
  idle: ["Meow! Shall I check the queue?", "Purr… ready when you are.", "Tap Preview and I'll sort them out."],
  thinking: ["Reading the rules…", "Checking every case…", "Hmm, comparing the flows…"],
  success: ["Done! Those were easy.", "Purr-fect.", "All saved, with the full trace."],
  alert: ["Some cases need a person.", "I left the tricky ones for you."],
  error: ["Oops, something went wrong.", "I couldn't reach the server."],
  empty: ["Nothing pending. Nap time!", "Queue is clear. Zzz…"]
};
const CUBES: Array<{ s: number; x: number; y: number; z: number }> = [
  { s: 46, x: -30, y: 22, z: 0 }, { s: 46, x: 18, y: 22, z: 0 }, { s: 46, x: -6, y: 22, z: -44 }, { s: 46, x: -6, y: -22, z: -20 }
];

export function CatStage({ mood, size = 150 }: { mood: CatMood; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [say, setSay] = useState<string | null>(null);
  const [hop, setHop] = useState(0);
  const sayTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const el = ref.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
      const ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--ry", `${nx * 16}deg`); el.style.setProperty("--rx", `${-ny * 10}deg`);
        setLook({ x: nx, y: ny });
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
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
    <div className="cat-scene" aria-hidden="true">
      {CUBES.map((c, i) => <div key={i} className="g-cube" style={{ ["--s" as string]: c.s + "px", ["--x" as string]: c.x + "px", ["--y" as string]: c.y + "px", ["--z" as string]: c.z + "px" }}>
        <i className="f f1"/><i className="f f2"/><i className="f f3"/><i className="f f4"/><i className="f f5"/>
      </div>)}
    </div>
    <button type="button" className={"cat-poke" + (hop ? " hop-" + (hop % 2) : "")} onClick={poke} aria-label={"Miko the auto-judge cat. " + LINES[mood][0]}>
      <CatMascot mood={mood} size={Math.round(size * 0.5)} look={look}/>
    </button>
    {say && <span className="cat-say" role="status">{say}</span>}
  </div>;
}
