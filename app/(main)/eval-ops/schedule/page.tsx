import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import EvalScheduleView from "@/components/eval-ops/EvalScheduleView";

async function gate() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
}

export default async function EvalSchedulePage() {
  await gate();
  return <EvalScheduleView />;
}
