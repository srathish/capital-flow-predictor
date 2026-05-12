import type { Metadata } from "next";
import { MyWatchlist } from "@/components/my-watchlist";
import { WatchlistGrid } from "@/components/watchlist-grid";

export const metadata: Metadata = {
  title: "Watchlist · Bellwether",
};

export default function WatchlistPage() {
  return (
    <div className="space-y-6">
      <MyWatchlist />
      <WatchlistGrid />
    </div>
  );
}
