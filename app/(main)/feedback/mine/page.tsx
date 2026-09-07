import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessCallQuality } from "@/lib/adminEmails";
import FeedbackQualityEval from "@/components/FeedbackQualityEval";

export default async function FeedbackMinePage() {
  const session = await getServerSession(authOptions);
  if (!canAccessCallQuality(session?.user?.email)) redirect("/");
  return <FeedbackQualityEval mode="mine" />;
}
