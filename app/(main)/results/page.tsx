import { redirect } from "next/navigation";
import { gateQualityEval } from "./qualityEvalGate";

export default async function ResultsIndexPage() {
  await gateQualityEval();
  redirect("/results/report");
}
