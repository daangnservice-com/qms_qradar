import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessEvalOpsFull } from "@/lib/adminEmails";
import AutoEvalRunWorkbench from "@/components/eval-ops/AutoEvalRunWorkbench";

export default async function AutoEvalRunPage() {
  const session = await getServerSession(authOptions);
  if (!canAccessEvalOpsFull(session?.user?.email)) redirect("/");
  return <AutoEvalRunWorkbench />;
}
