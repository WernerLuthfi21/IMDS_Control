/**
 * "Miko", the Judgement cat. Hand-drawn-style inline SVG (no external asset), six moods.
 * Big round head, small loaf body, soft cheeks — friendly, not robotic.
 * Decorative by default; pass `label` when the mood itself carries meaning.
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
  const closed = mood === "success" || mood === "empty";
  const eyeShift = look ? `translate(${(look.x * 2.6).toFixed(2)}px, ${(look.y * 1.8).toFixed(2)}px)` : undefined;
  const headTilt = look ? `rotate(${(look.x * 5).toFixed(2)}deg)` : undefined;
  return <span className={"cat cat-" + mood} style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <svg viewBox="0 0 102 102" width={size} height={size}>
      <ellipse className="cat-shadow" cx="51" cy="95" rx="27" ry="4.5"/>
      <path className="cat-tail" d="M72 86 c16 1 20 -14 12 -22 c-4 -4 -9 -2 -7 2" fill="none" strokeWidth="7" strokeLinecap="round"/>
      <path className="cat-body" d="M26 92 c-3 -20 8 -32 25 -32 s28 12 25 32 z"/>
      <ellipse className="cat-belly" cx="51" cy="82" rx="12" ry="9"/>
      <ellipse className="cat-paw" cx="40" cy="91" rx="6.5" ry="4"/><ellipse className="cat-paw" cx="62" cy="91" rx="6.5" ry="4"/>
      <g className="cat-headgrp" style={{ transform: headTilt, transformOrigin: "51px 62px", transition: "transform .25s ease-out" }}>
        <path className="cat-ear" d="M19 36 Q17 10 22 8 Q30 9 41 22 Z M83 36 Q85 10 80 8 Q72 9 61 22 Z"/>
        <path className="cat-ear-in" d="M23 30 Q22 16 25 14 Q30 16 36 23 Z M79 30 Q80 16 77 14 Q72 16 66 23 Z"/>
        <ellipse className="cat-head" cx="51" cy="42" rx="33" ry="27"/>
        <g className="cat-eyes"><g style={{ transform: eyeShift, transition: "transform .12s ease-out" }}>
          {closed
            ? <><path d="M32 43 q6 -6 12 0" fill="none" strokeWidth="3" strokeLinecap="round"/><path d="M58 43 q6 -6 12 0" fill="none" strokeWidth="3" strokeLinecap="round"/></>
            : <><ellipse cx="38" cy="42" rx="5.6" ry={mood === "alert" ? 7.2 : 6.4}/><ellipse cx="64" cy="42" rx="5.6" ry={mood === "alert" ? 7.2 : 6.4}/>
              <circle className="cat-glint" cx="40" cy="39.4" r="2"/><circle className="cat-glint" cx="66" cy="39.4" r="2"/>
              <circle className="cat-glint" cx="36.6" cy="45" r=".9"/><circle className="cat-glint" cx="62.6" cy="45" r=".9"/></>}
        </g></g>
        <ellipse className="cat-cheek" cx="27" cy="53" rx="5" ry="3"/><ellipse className="cat-cheek" cx="75" cy="53" rx="5" ry="3"/>
        <path className="cat-nose" d="M48.6 52.2 h4.8 l-2.4 2.8 z"/>
        <path className="cat-mouth" d={MOUTH[mood]} fill="none" strokeWidth="2" strokeLinecap="round"/>
        <g className="cat-whisk" strokeWidth="1.3" strokeLinecap="round" fill="none"><path d="M14 50 q8 -1 13 1 M15 57 q7 -3 12 -2 M88 50 q-8 -1 -13 1 M87 57 q-7 -3 -12 -2"/></g>
      </g>
      {mood === "thinking" && <g className="cat-dots"><circle cx="86" cy="14" r="3"/><circle cx="93" cy="8" r="3"/><circle cx="99" cy="2" r="3"/></g>}
      {mood === "alert" && <path className="cat-mark" d="M92 4 v12 M92 22 v.5" strokeWidth="4" strokeLinecap="round"/>}
      {mood === "success" && <path className="cat-mark ok" d="M82 12 l6 6 l11 -13" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>}
      {mood === "error" && <path className="cat-mark bad" d="M84 4 l12 12 M96 4 l-12 12" strokeWidth="4" strokeLinecap="round"/>}
    </svg>
  </span>;
}
