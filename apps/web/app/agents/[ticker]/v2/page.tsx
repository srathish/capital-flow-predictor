import { OfficeView } from "@/components/office-view";

export default async function AgentOfficePage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  return <OfficeView ticker={ticker} />;
}
