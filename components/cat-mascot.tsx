/**
 * "Miko", the Judgement cat. Original inline SVG (no external asset, ~2 KB), six moods.
 * Decorative by default; pass `label` when the mood itself carries meaning.
 */
export type CatMood = "idle" | "thinking" | "success" | "alert" | "error" | "empty";

const MOUTH: Record<CatMood, string> = {
  idle: "M27 39 q3 3 6 0 q3 3 6 0",
  thinking: "M29 40 h8",
  success: "M26 38 q7 7 14 0",
  alert: "M29 41 q4 -3 8 0",
  error: "M27 42 q6 -5 12 0",
  empty: "M29 40 q4 2 8 0"
};

export function CatMascot({ mood = "idle", size = 64, label, look }: { mood?: CatMood; size?: number; label?: string; look?: { x: number; y: number } }) {
  const closed = mood === "success" || mood === "empty";
  const eyeShift = look ? `translate(${(look.x * 2.2).toFixed(2)}px, ${(look.y * 1.6).toFixed(2)}px)` : undefined;
  const headTilt = look ? `rotate(${(look.x * 6).toFixed(2)}deg)` : undefined;
  return <span className={"cat cat-" + mood} style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <svg viewBox="0 0 66 66" width={size} height={size}>
      <defs>
        <radialGradient id="cat-fur" cx="40%" cy="30%" r="80%"><stop offset="0" stopColor="var(--cat-fur-hi)"/><stop offset="1" stopColor="var(--cat-fur)"/></radialGradient>
      </defs>
      <ellipse className="cat-shadow" cx="33" cy="61" rx="17" ry="3"/>
      <path className="cat-tail" d="M48 52 q14 -2 10 -16 q-2 -6 -6 -3" fill="none" strokeWidth="5" strokeLinecap="round"/>
      <path className="cat-body" d="M17 58 q-2 -18 16 -20 q18 2 16 20 z" fill="url(#cat-fur)"/>
      <path className="cat-ear" d="M13 22 L15 4 L28 15 Z M53 22 L51 4 L38 15 Z" fill="url(#cat-fur)"/>
      <path className="cat-ear-in" d="M16 18 L17 9 L24 15 Z M50 18 L49 9 L42 15 Z"/>
      <g className="cat-headgrp" style={{ transform: headTilt, transformOrigin: "33px 40px", transition: "transform .25s ease-out" }}>
      <ellipse className="cat-head" cx="33" cy="27" rx="21" ry="17" fill="url(#cat-fur)"/>
      <g className="cat-eyes"><g style={{ transform: eyeShift, transition: "transform .12s ease-out" }}>
        {closed
          ? <><path d="M21 27 q4 -4 8 0" fill="none" strokeWidth="2.4" strokeLinecap="round"/><path d="M37 27 q4 -4 8 0" fill="none" strokeWidth="2.4" strokeLinecap="round"/></>
          : <><ellipse cx="25" cy="27" rx="3.4" ry={mood === "alert" ? 4.6 : 4}/><ellipse cx="41" cy="27" rx="3.4" ry={mood === "alert" ? 4.6 : 4}/><circle className="cat-glint" cx="26.2" cy="25.5" r="1.1"/><circle className="cat-glint" cx="42.2" cy="25.5" r="1.1"/></>}
      </g></g>
      <path className="cat-nose" d="M31.3 33.5 h3.4 l-1.7 2 z"/>
      <path className="cat-mouth" d={MOUTH[mood]} fill="none" strokeWidth="1.6" strokeLinecap="round"/>
      <g className="cat-whisk" strokeWidth="1.1" strokeLinecap="round"><path d="M12 32 h8 M12 36 l8 -1.5 M46 32 h8 M46 35.5 l8 1.5"/></g>
      <ellipse className="cat-cheek" cx="20" cy="35" rx="3" ry="1.8"/><ellipse className="cat-cheek" cx="46" cy="35" rx="3" ry="1.8"/>
      </g>
      {mood === "thinking" && <g className="cat-dots"><circle cx="54" cy="8" r="2"/><circle cx="59" cy="5" r="2"/><circle cx="64" cy="2" r="2"/></g>}
      {mood === "alert" && <path className="cat-mark" d="M58 4 v9 M58 17 v.5" strokeWidth="3" strokeLinecap="round"/>}
      {mood === "success" && <path className="cat-mark ok" d="M52 9 l4 4 l8 -9" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>}
      {mood === "error" && <path className="cat-mark bad" d="M53 3 l9 9 M62 3 l-9 9" strokeWidth="3" strokeLinecap="round"/>}
    </svg>
  </span>;
}
