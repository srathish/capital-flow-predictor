import { CatalystsView } from "@/components/catalysts-view";
import { ChatterLeaderboard } from "@/components/chatter-leaderboard";
import { RedditMentionsView } from "@/components/reddit-mentions-view";

export default function RedditPage() {
  return (
    <div className="space-y-10">
      <ChatterLeaderboard />

      <details open className="group">
        <summary className="flex cursor-pointer select-none items-baseline gap-2 border-b border-border pb-2 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
          <span className="transition-transform group-open:rotate-90">▸</span>
          <span className="font-semibold">Catalysts feed — every flagged event</span>
          <span className="text-[10px] normal-case tracking-normal">
            (highest-scored first)
          </span>
        </summary>
        <div className="mt-4">
          <CatalystsView />
        </div>
      </details>

      <details className="group">
        <summary className="flex cursor-pointer select-none items-baseline gap-2 border-b border-border pb-2 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
          <span className="transition-transform group-open:rotate-90">▸</span>
          <span className="font-semibold">Reddit chatter table — full predictive view</span>
          <span className="text-[10px] normal-case tracking-normal">
            (sortable, filterable, scorecard)
          </span>
        </summary>
        <div className="mt-4">
          <RedditMentionsView />
        </div>
      </details>
    </div>
  );
}
