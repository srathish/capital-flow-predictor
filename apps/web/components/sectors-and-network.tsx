"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SectorHeatmap } from "@/components/sector-heatmap";
import { NetworkView } from "@/components/network-view";
import { CohortsView } from "@/components/cohorts-view";

type View = "heatmap" | "cohorts" | "network";

const VIEWS: { value: View; label: string }[] = [
  { value: "heatmap", label: "Heatmap" },
  { value: "cohorts", label: "Cohorts" },
  { value: "network", label: "Network" },
];

export function SectorsAndNetwork() {
  const [view, setView] = useState<View>("heatmap");

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-full border border-border bg-card p-0.5 text-xs">
        {VIEWS.map((v) => {
          const active = v.value === view;
          return (
            <button
              key={v.value}
              type="button"
              onClick={() => setView(v.value)}
              className={cn(
                "rounded-full px-3 py-1 transition-colors",
                active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      {view === "heatmap" && <SectorHeatmap />}
      {view === "cohorts" && <CohortsView />}
      {view === "network" && <NetworkView />}
    </div>
  );
}
