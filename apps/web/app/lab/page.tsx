import type { Metadata } from "next";
import { LabView } from "@/components/lab-view";

export const metadata: Metadata = {
  title: "Lab · Bellwether",
  robots: { index: false, follow: false },  // keep the secret tab out of search results
};

export default function LabPage() {
  return <LabView />;
}
