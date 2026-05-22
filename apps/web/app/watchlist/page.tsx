import { redirect } from "next/navigation";

// /watchlist was folded into /screener (view toggle: Flat | By sector,
// with a "My list" sidebar). Kept as a redirect so old links don't 404.
export default function WatchlistPage() {
  redirect("/screener");
}
