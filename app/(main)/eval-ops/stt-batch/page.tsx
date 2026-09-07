import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessEvalOpsFull } from "@/lib/adminEmails";
import SttBatchScheduleWorkbench from "@/components/eval-ops/SttBatchScheduleWorkbench";

export default async function SttBatchSchedulePage() {
  const session = await getServerSession(authOptions);
  if (!canAccessEvalOpsFull(session?.user?.email)) redirect("/");
  return <SttBatchScheduleWorkbench />;
}
