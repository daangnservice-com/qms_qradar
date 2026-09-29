import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessEvalOpsNav } from "@/lib/sessionAccessServer";
import EvalScheduleView from "@/components/eval-ops/EvalScheduleView";

async function gate() {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessEvalOpsNav(session)) redirect("/");
}

export default async function EvalSchedulePage() {
  await gate();
  return <EvalScheduleView />;
}
