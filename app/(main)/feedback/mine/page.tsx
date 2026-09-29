import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessEvalProgress } from "@/lib/sessionAccessServer";
import FeedbackQualityEval from "@/components/FeedbackQualityEval";

export default async function FeedbackMinePage() {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessEvalProgress(session)) redirect("/");
  return <FeedbackQualityEval mode="mine" />;
}
