import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessCallQuality } from "@/lib/sessionAccessServer";
import FeedbackQualityEval from "@/components/FeedbackQualityEval";

export default async function FeedbackPage() {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessCallQuality(session)) redirect("/");
  return <FeedbackQualityEval mode="all" />;
}
