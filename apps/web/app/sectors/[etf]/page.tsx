import { SectorHoldingsView } from "@/components/sector-holdings-view";

export default async function SectorDetailPage({
  params,
}: {
  params: Promise<{ etf: string }>;
}) {
  const { etf } = await params;
  return <SectorHoldingsView etf={etf} />;
}
