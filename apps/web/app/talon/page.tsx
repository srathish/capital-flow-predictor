"use client";

import { useState } from "react";
import { TalonView } from "@/components/talon-view";
import { TalonTopPlaysView } from "@/components/talon-top-plays-view";
import { cn } from "@/lib/utils";

type Tab = "scanner" | "top-plays";

export default function TalonPage() {
  const [tab, setTab] = useState<Tab>("scanner");
  return (
    <div className="mx-auto max-w-7xl space-y-3 px-4 py-6">
      <div className="flex items-center gap-1 rounded-full bg-foreground/[0.03] p-1 text-sm w-fit">
        <TabButton active={tab === "scanner"} onClick={() => setTab("scanner")}>
          Scanner
        </TabButton>
        <TabButton active={tab === "top-plays"} onClick={() => setTab("top-plays")}>
          Top 20 Plays
        </TabButton>
      </div>
      {tab === "scanner" ? <TalonView /> : <TalonTopPlaysView />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-4 py-1.5 transition-colors",
        active
          ? "bg-primary text-white shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
