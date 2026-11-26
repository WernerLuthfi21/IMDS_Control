"use client";
import { useEffect, useRef, type CSSProperties } from "react";
const geometry=[{s:124,x:-34,y:14,z:0,delay:0,blink:0},{s:92,x:74,y:-54,z:-34,delay:.9,blink:1.7},{s:72,x:56,y:70,z:42,delay:1.8,blink:3.1}];
/** Original three-cube geometry and expressions, no new mascot. */
export function TrackerMascot(){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const cubes=ref.current, hero=cubes?.closest(".trk-hero");if(!cubes||!hero)return;
  const reduce=matchMedia("(prefers-reduced-motion: reduce)");
  let timer:ReturnType<typeof setTimeout>|undefined;
  const reset=()=>{for(const k of ["--rx","--ry","--px","--py"])cubes.style.removeProperty(k);cubes.querySelectorAll<HTMLElement>(".pupil").forEach(p=>p.style.removeProperty("transform"));};
  const move=(event:Event)=>{if(reduce.matches)return;const e=event as PointerEvent,r=hero.getBoundingClientRect();if(!r.width||!r.height)return;const x=(e.clientX-r.left)/r.width*2-1,y=(e.clientY-r.top)/r.height*2-1;cubes.style.setProperty("--ry",x*18+"deg");cubes.style.setProperty("--rx",-y*12+"deg");cubes.style.setProperty("--px",x*10+"px");cubes.style.setProperty("--py",y*8+"px");cubes.querySelectorAll<HTMLElement>(".pupil").forEach(p=>{const r=p.parentElement!.getBoundingClientRect(),dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2,d=Math.hypot(dx,dy)||1,k=Math.min(1,d/140)*r.width*.2;p.style.transform="translate("+dx/d*k+"px,"+dy/d*k+"px)";});};
  const poke=()=>{if(reduce.matches)return;cubes.classList.add("poke");clearTimeout(timer);timer=setTimeout(()=>cubes.classList.remove("poke"),650);};
  hero.addEventListener("pointermove",move);hero.addEventListener("pointerleave",reset);hero.addEventListener("pointercancel",reset);hero.addEventListener("pointerdown",poke);reduce.addEventListener("change",reset);
  return()=>{clearTimeout(timer);hero.removeEventListener("pointermove",move);hero.removeEventListener("pointerleave",reset);hero.removeEventListener("pointercancel",reset);hero.removeEventListener("pointerdown",poke);reduce.removeEventListener("change",reset);};
 },[]);
 return <div className="trk-mascot" aria-hidden="true"><div className="cube-stage"><div className="cubes" ref={ref}>{geometry.map((c,i)=><div className="cube" key={i} style={{"--s":c.s+"px","--x":c.x+"px","--y":c.y+"px","--z":c.z+"px","--bd":c.delay+"s"} as CSSProperties}><i className="f f1"><span className={"face m"+(i+1)} style={{"--d":c.blink+"s"} as CSSProperties}><span className="eye l"><i className="pupil"/></span><span className="eye r"><i className="pupil"/></span><span className="cheek l"/><span className="cheek r"/><span className="mouth"/></span></i>{[2,3,4,5,6].map(n=><i key={n} className={"f f"+n}/>)}</div>)}</div></div></div>;
}
