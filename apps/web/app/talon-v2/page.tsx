"use client";

import { useState } from "react";
import { TalonV2TopPlaysView } from "@/components/talon-v2-top-plays-view";
import { TalonV2View } from "@/components/talon-v2-view";
import { cn } from "@/lib/utils";

type Tab = "scanner" | "top-plays";

export default function TalonV2Page() {
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
      {tab === "scanner" ? <TalonV2View /> : <TalonV2TopPlaysView />}
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
