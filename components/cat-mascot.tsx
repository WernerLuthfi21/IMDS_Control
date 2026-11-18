import { useId } from "react";

/**
 * "Miko", the Judgement cat. Inline SVG (no external asset), six moods.
 * Shaded like a soft 3D toy: radial light from the top left, rim shadow, glossy eyes,
 * blushing cheeks and a contact shadow under the head. Decorative by default; pass `label`
 * when the mood itself carries meaning.
 */
export type CatMood = "idle" | "thinking" | "success" | "alert" | "error" | "empty";

const MOUTH: Record<CatMood, string> = {
  idle: "M45 58 q3 3.2 6 0 q3 3.2 6 0",
  thinking: "M47 59.5 h8",
  success: "M44 56.5 q7 7 14 0",
  alert: "M47 60.5 q4 -2.6 8 0",
  error: "M45 61.5 q6 -4.6 12 0",
  empty: "M47 59 q4 2 8 0"
};

export function CatMascot({ mood = "idle", size = 64, label, look }: { mood?: CatMood; size?: number; label?: string; look?: { x: number; y: number } }) {
  const raw = useId();
  const id = "m" + raw.replace(/[^a-zA-Z0-9]/g, "");
  const u = (k: string) => `url(#${id}-${k})`;
  const closed = mood === "success" || mood === "empty";
  const eyeShift = look ? `translate(${(look.x * 2.6).toFixed(2)}px, ${(look.y * 1.8).toFixed(2)}px)` : undefined;
  const headTilt = look ? `rotate(${(look.x * 5).toFixed(2)}deg)` : undefined;
  return <span className={"cat cat3d cat-" + mood} style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <svg viewBox="0 0 102 102" width={size} height={size}>
      <defs>
        <radialGradient id={`${id}-fur`} cx="36%" cy="28%" r="78%">
          <stop offset="0" style={{ stopColor: "var(--cat-fur-hi)" }}/>
          <stop offset=".42" style={{ stopColor: "var(--cat-fur)" }}/>
          <stop offset="1" style={{ stopColor: "var(--cat-line)" }}/>
        </radialGradient>
        <radialGradient id={`${id}-body`} cx="40%" cy="20%" r="90%">
          <stop offset="0" style={{ stopColor: "var(--cat-fur-hi)" }}/>
          <stop offset=".5" style={{ stopColor: "var(--cat-fur)" }}/>
          <stop offset="1" style={{ stopColor: "var(--cat-line)" }}/>
        </radialGradient>
        <radialGradient id={`${id}-belly`} cx="45%" cy="35%" r="70%">
          <stop offset="0" stopColor="#fffaf0"/><stop offset="1" style={{ stopColor: "var(--cat-fur-hi)" }}/>
        </radialGradient>
        <linearGradient id={`${id}-ear`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--cat-fur-hi)" }}/><stop offset="1" style={{ stopColor: "var(--cat-fur)" }}/>
        </linearGradient>
        <radialGradient id={`${id}-eye`} cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#5a3a22"/><stop offset=".55" stopColor="#2a1a0e"/><stop offset="1" stopColor="#120a04"/>
        </radialGradient>
        <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>
        <filter id={`${id}-shade`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.6"/></filter>
      </defs>
      <ellipse className="cat-shadow" cx="51" cy="95" rx="27" ry="4.5" filter={u("soft")}/>
      <g className="cat-float">
        <path className="cat-tail" d="M72 86 c16 1 20 -14 12 -22 c-4 -4 -9 -2 -7 2" fill="none" strokeWidth="7" strokeLinecap="round"/>
        <path className="cat-body" d="M26 92 c-3 -20 8 -32 25 -32 s28 12 25 32 z" style={{ fill: u("body") }}/>
        <ellipse className="cat-belly" cx="51" cy="82" rx="12" ry="9" style={{ fill: u("belly") }}/>
        <ellipse cx="51" cy="66" rx="21" ry="5" fill="rgba(80,40,10,.28)" filter={u("shade")}/>
        <ellipse className="cat-paw" cx="40" cy="91" rx="6.5" ry="4" style={{ fill: u("belly") }}/><ellipse className="cat-paw" cx="62" cy="91" rx="6.5" ry="4" style={{ fill: u("belly") }}/>
        <g className="cat-headgrp" style={{ transform: headTilt, transformOrigin: "51px 62px", transition: "transform .3s cubic-bezier(.2,.8,.2,1)" }}>
          <g className="cat-ears">
            <path className="cat-ear" d="M19 36 Q17 10 22 8 Q30 9 41 22 Z M83 36 Q85 10 80 8 Q72 9 61 22 Z" style={{ fill: u("ear") }}/>
            <path className="cat-ear-in" d="M23 30 Q22 16 25 14 Q30 16 36 23 Z M79 30 Q80 16 77 14 Q72 16 66 23 Z"/>
          </g>
          <ellipse className="cat-head" cx="51" cy="42" rx="33" ry="27" style={{ fill: u("fur") }}/>
          <ellipse cx="40" cy="27" rx="13" ry="6" fill="#fff" opacity=".35" filter={u("soft")}/>
          <g className="cat-eyes"><g style={{ transform: eyeShift, transition: "transform .15s ease-out" }}>
            {closed
              ? <><path d="M32 43 q6 -6 12 0" fill="none" strokeWidth="3" strokeLinecap="round"/><path d="M58 43 q6 -6 12 0" fill="none" strokeWidth="3" strokeLinecap="round"/></>
              : <><ellipse cx="38" cy="42" rx="6.2" ry={mood === "alert" ? 7.8 : 7} style={{ fill: u("eye") }}/><ellipse cx="64" cy="42" rx="6.2" ry={mood === "alert" ? 7.8 : 7} style={{ fill: u("eye") }}/>
                <circle className="cat-glint" cx="40.2" cy="38.8" r="2.4"/><circle className="cat-glint" cx="66.2" cy="38.8" r="2.4"/>
                <circle className="cat-glint" cx="36.4" cy="45.4" r="1.1"/><circle className="cat-glint" cx="62.4" cy="45.4" r="1.1"/></>}
          </g></g>
          <ellipse className="cat-cheek" cx="27" cy="53" rx="5.5" ry="3.4" filter={u("soft")}/><ellipse className="cat-cheek" cx="75" cy="53" rx="5.5" ry="3.4" filter={u("soft")}/>
          <path className="cat-nose" d="M48.6 52.2 h4.8 l-2.4 2.8 z"/>
          <path className="cat-mouth" d={MOUTH[mood]} fill="none" strokeWidth="2" strokeLinecap="round"/>
          <g className="cat-whisk" strokeWidth="1.3" strokeLinecap="round" fill="none"><path d="M14 50 q8 -1 13 1 M15 57 q7 -3 12 -2 M88 50 q-8 -1 -13 1 M87 57 q-7 -3 -12 -2"/></g>
        </g>
      </g>
      {mood === "thinking" && <g className="cat-dots"><circle cx="86" cy="14" r="3"/><circle cx="93" cy="8" r="3"/><circle cx="99" cy="2" r="3"/></g>}
      {mood === "alert" && <path className="cat-mark" d="M92 4 v12 M92 22 v.5" strokeWidth="4" strokeLinecap="round"/>}
      {mood === "success" && <g className="cat-spark"><path d="M88 6 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z"/><path d="M12 10 l1.4 3.4 l3.4 1.4 l-3.4 1.4 l-1.4 3.4 l-1.4 -3.4 l-3.4 -1.4 l3.4 -1.4 z"/></g>}
      {mood === "error" && <path className="cat-mark bad" d="M84 4 l12 12 M96 4 l-12 12" strokeWidth="4" strokeLinecap="round"/>}
    </svg>
  </span>;
}
