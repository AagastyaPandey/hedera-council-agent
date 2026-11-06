import type { Metadata } from "next";
import { PresentationView } from "./PresentationView";

export const metadata: Metadata = {
  title: "Presentation",
  description: "A seven-slide, offline presentation of the AegisDAO IntentLock decision trail.",
};

export default function PresentPage() {
  return <PresentationView />;
}
