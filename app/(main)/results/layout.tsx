import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessMonthlyReport } from "@/lib/sessionAccessServer";

/** 가장 넓은 권한(월간 리포트)만 확인. 그 외 페이지는 각 page에서 quality eval로 다시 막는다. */
async function gate() {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessMonthlyReport(session)) redirect("/");
}

export default async function ResultsLayout({ children }: { children: React.ReactNode }) {
  await gate();
  return <div className="qms-page min-h-full">{children}</div>;
}
