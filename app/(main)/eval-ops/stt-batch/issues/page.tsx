import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessEvalOpsFull } from "@/lib/adminEmails";
import SttIssueReportsWorkbench from "@/components/SttIssueReportsWorkbench";

export default async function SttBatchIssuesPage() {
  const session = await getServerSession(authOptions);
  if (!canAccessEvalOpsFull(session?.user?.email)) redirect("/");
  return <SttIssueReportsWorkbench />;
}
