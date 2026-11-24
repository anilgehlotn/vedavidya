// Small motion toolkit: scroll reveals, scroll progress, count-ups and typing.
// Everything degrades to static content when JS is off or the visitor prefers reduced motion.
import { useEffect, useRef, useState, type RefObject } from "react";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Adds .is-in to every [data-reveal] element as it scrolls into view.
export function useReveal(dep: unknown) {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-in)")];
    if (prefersReducedMotion() || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("is-in")); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [dep]);
}

// 0 → 1 as the element travels through the viewport (0 when its top hits the bottom edge,
// 1 when its bottom reaches the top edge, or when `end` says so).
export function useScrollProgress<T extends HTMLElement>(mode: "through" | "pin" = "through"): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const v = mode === "pin" ? -r.top / Math.max(1, r.height - vh) : (vh - r.top) / (vh + r.height);
      setP(Math.min(1, Math.max(0, v)));
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, [mode]);
  return [ref, p];
}

function useInView<T extends HTMLElement>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen];
}

export function CountUp({ to, decimals = 0, duration = 1400, suffix = "" }: { to: number; decimals?: number; duration?: number; suffix?: string }) {
  const [ref, seen] = useInView<HTMLSpanElement>();
  const [v, setV] = useState(prefersReducedMotion() ? to : 0);
  useEffect(() => {
    if (!seen || prefersReducedMotion()) { if (seen) setV(to); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      setV(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, to]);
  return <span ref={ref} className="tabular">{v.toFixed(decimals)}{suffix}</span>;
}

// Types each line in turn, pauses, then moves to the next.
export function Typewriter({ lines, speed = 28 }: { lines: string[]; speed?: number }) {
  const [ref, seen] = useInView<HTMLSpanElement>();
  const [i, setI] = useState(0);
  const [n, setN] = useState(prefersReducedMotion() ? lines[0].length : 0);
  useEffect(() => {
    if (!seen || prefersReducedMotion()) return;
    const line = lines[i];
    const t = n < line.length ? setTimeout(() => setN(n + 1), speed) : setTimeout(() => { setI((i + 1) % lines.length); setN(0); }, 2600);
    return () => clearTimeout(t);
  }, [seen, n, i]);
  return <span ref={ref}>{lines[i].slice(0, n)}<i className="caret" aria-hidden /></span>;
}
