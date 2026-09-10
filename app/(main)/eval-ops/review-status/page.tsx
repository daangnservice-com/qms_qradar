import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessCallQuality } from "@/lib/sessionAccessServer";
import ReviewStatusWorkbench from "@/components/eval-ops/ReviewStatusWorkbench";

export default async function ReviewStatusPage() {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessCallQuality(session)) redirect("/");
  return <ReviewStatusWorkbench />;
}
