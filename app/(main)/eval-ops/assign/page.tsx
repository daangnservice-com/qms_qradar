import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessEvalOps } from "@/lib/adminEmails";
import EvalOpsWorkbench from "@/components/eval-ops/EvalOpsWorkbench";

async function gate() {
  const session = await getServerSession(authOptions);
  if (!canAccessEvalOps(session?.user?.email)) redirect("/");
}

export default async function Page() {
  await gate();
  return (
    <Suspense fallback={<div className="qms-page-body p-6 text-[13px] text-[var(--fg-tertiary)]">불러오는 중…</div>}>
      <EvalOpsWorkbench />
    </Suspense>
  );
}
