import type { Metadata } from "next";
import { WatchlistGrid } from "@/components/watchlist-grid";

export const metadata: Metadata = {
  title: "Watchlist · Bellwether",
};

export default function WatchlistPage() {
  return <WatchlistGrid />;
}
