"use client";

import { useEffect, useState } from "react";

const SESSION_KEY = "bellwether_intro_seen";
type Phase = "hidden" | "intro" | "zooming";

export function IntroSplash() {
  const [phase, setPhase] = useState<Phase>("hidden");

  useEffect(() => {
    try {
      if (!sessionStorage.getItem(SESSION_KEY)) setPhase("intro");
    } catch {
      setPhase("intro");
    }
  }, []);

  useEffect(() => {
    if (phase !== "intro") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") enter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  const enter = () => {
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {}
    setPhase("zooming");
    window.setTimeout(() => setPhase("hidden"), 900);
  };

  if (phase === "hidden") return null;

  const zooming = phase === "zooming";

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-background transition-opacity duration-700 ease-out ${
        zooming ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      aria-hidden={zooming}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />

      <div
        className={`flex flex-col items-center gap-5 transition-all duration-[900ms] ${
          zooming ? "scale-[36] opacity-0" : "scale-100 opacity-100"
        }`}
        style={{
          transformOrigin: "center",
          transitionTimingFunction: zooming
            ? "cubic-bezier(0.7, 0, 0.84, 0)"
            : "ease-out",
        }}
      >
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.35em] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          <span>Markets are open</span>
        </div>

        <div className="font-mono text-5xl sm:text-7xl font-semibold tracking-tight leading-none">
          BELL<span className="text-primary">WETHER</span>
        </div>

        <div className="max-w-md px-6 text-center text-sm text-muted-foreground">
          Who&apos;s leading, who&apos;s lagging, and why.
        </div>
      </div>

      {!zooming && (
        <>
          <button
            type="button"
            onClick={enter}
            className="group absolute bottom-28 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-6 py-2.5 text-sm font-medium text-primary transition-all hover:scale-105 hover:bg-primary/20"
          >
            Come Inside
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </button>
          <button
            type="button"
            onClick={enter}
            className="absolute bottom-10 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            skip
          </button>
        </>
      )}
    </div>
  );
}
