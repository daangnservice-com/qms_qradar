import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessEvalOpsFull } from "@/lib/adminEmails";
import EvalBatchScheduleWorkbench from "@/components/eval-ops/EvalBatchScheduleWorkbench";

export default async function EvalBatchSchedulePage() {
  const session = await getServerSession(authOptions);
  if (!canAccessEvalOpsFull(session?.user?.email)) redirect("/");
  return <EvalBatchScheduleWorkbench />;
}
