import { EnsembleView } from "@/components/ensemble-view";

export default async function AgentEnsemblePage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  return <EnsembleView ticker={ticker} />;
}
