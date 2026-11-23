import { useId } from "react";

/**
 * "Miko", the Judgement cat, drawn from the approved character sheet (`public/miko/*.webp`, one master design).
 * The image sits inside the same 102x102 SVG as before, so the existing `.cat svg` animations, sizing and the
 * status marks (gear, clock, dots, !, x, sparkles) keep working. Decorative by default; pass `label` when the
 * mood itself carries meaning.
 */
/** idle · working (busy saving/loading) · thinking · success · waiting (on someone else) · alert (warning) · error · celebrate (batch done) · empty. */
export type CatMood = "idle" | "working" | "thinking" | "success" | "waiting" | "alert" | "error" | "celebrate" | "empty";

/** mood -> pose file in public/miko. Same character in every mood. */
const POSE: Record<CatMood, string> = {
  idle: "sitting", working: "working", thinking: "thinking", success: "happy", waiting: "sleeping",
  alert: "surprised", error: "sad", celebrate: "cheer", empty: "curious"
};

export function CatMascot({ mood = "idle", size = 64, label, look }: { mood?: CatMood; size?: number; label?: string; look?: { x: number; y: number } }) {
  const raw = useId();
  const id = "m" + raw.replace(/[^a-zA-Z0-9]/g, "");
  const u = (k: string) => `url(#${id}-${k})`;
  const pose = POSE[mood];
  const eyeShift = look ? `translate(${(look.x * 2.6).toFixed(2)}px, ${(look.y * 1.8).toFixed(2)}px)` : undefined;
  const headTilt = look ? `rotate(${(look.x * 5).toFixed(2)}deg)` : undefined;
  return <span className={"cat cat3d cat-" + mood} style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <svg viewBox="0 0 102 102" width={size} height={size}>
      <defs><filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter></defs>
      <ellipse className="cat-shadow" cx="45" cy="95" rx="27" ry="4.5" filter={u("soft")}/>
      <g className="cat-float" style={{ transform: headTilt && `${eyeShift} ${headTilt}`, transformOrigin: "45px 92px", transition: "transform .3s cubic-bezier(.2,.8,.2,1)" }}>
        <image href={`/miko/${pose}.webp`} x="3" y="6" width="84" height="88" preserveAspectRatio="xMidYMax meet"/>
      </g>
      {mood === "working" && <g className="cat-gear" fill="none" strokeWidth="3" strokeLinecap="round"><circle cx="91" cy="11" r="6"/><path d="M91 1 v3 M91 18 v3 M81 11 h3 M98 11 h3"/></g>}
      {mood === "waiting" && <g className="cat-clock" fill="none" strokeWidth="3" strokeLinecap="round"><circle cx="91" cy="11" r="8"/><path d="M91 6 v5 l4 2"/></g>}
      {mood === "thinking" && <g className="cat-dots"><circle cx="86" cy="14" r="3"/><circle cx="93" cy="8" r="3"/><circle cx="99" cy="2" r="3"/></g>}
      {mood === "alert" && <path className="cat-mark" d="M92 4 v12 M92 22 v.5" strokeWidth="4" strokeLinecap="round"/>}
      {(mood === "success" || mood === "celebrate") && <g className="cat-spark"><path d="M88 6 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z"/><path d="M12 10 l1.4 3.4 l3.4 1.4 l-3.4 1.4 l-1.4 3.4 l-1.4 -3.4 l-3.4 -1.4 l3.4 -1.4 z"/></g>}
      {mood === "celebrate" && <g className="cat-spark cat-confetti"><rect x="4" y="30" width="5" height="5" rx="1" transform="rotate(20 6 32)"/><rect x="93" y="34" width="5" height="5" rx="1" transform="rotate(-25 95 36)"/><circle cx="18" cy="4" r="2.5"/><circle cx="78" cy="2" r="2.5"/></g>}
      {mood === "error" && <path className="cat-mark bad" d="M84 4 l12 12 M96 4 l-12 12" strokeWidth="4" strokeLinecap="round"/>}
    </svg>
  </span>;
}
