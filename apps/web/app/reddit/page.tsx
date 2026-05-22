import { CatalystsView } from "@/components/catalysts-view";
import { RedditMentionsView } from "@/components/reddit-mentions-view";

export default function RedditPage() {
  return (
    <div className="space-y-10">
      <CatalystsView />
      <div className="border-t border-border" />
      <RedditMentionsView />
    </div>
  );
}
