import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessCallQuality } from "@/lib/adminEmails";
import ReviewStatusWorkbench from "@/components/eval-ops/ReviewStatusWorkbench";

export default async function ReviewStatusPage() {
  const session = await getServerSession(authOptions);
  if (!canAccessCallQuality(session?.user?.email)) redirect("/");
  return <ReviewStatusWorkbench />;
}
