import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessEvalProgress } from "@/lib/sessionAccessServer";

export default async function FeedbackReviewRequestsPage() {
  const session = await getServerSession(authOptions);
  if (!(await ensureSessionCanAccessEvalProgress(session))) redirect("/");
  return (
    <div className="qms-page p-8">
      <h1 className="text-[20px] font-extrabold tracking-tight">검수 요청</h1>
      <p className="mt-2 text-[13px] text-[var(--fg-secondary)]">
        지금은 콜 평가만 공용 레저부어를 씁니다. 문의 채널은 같은 방식으로 이어 붙일 예정입니다.
      </p>
    </div>
  );
}
