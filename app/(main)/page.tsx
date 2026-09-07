import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import {
  canAccessCallQuality,
  isAdmin,
} from "@/lib/adminEmails";

export default async function Home() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (canAccessCallQuality(email)) redirect("/call-quality");
  if (isAdmin(email)) redirect("/usage");

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[18px] font-bold text-[var(--fg-primary)]">접근 권한이 없습니다</h1>
      <p className="mt-2 max-w-sm text-[14px] text-[var(--fg-secondary)]">
        QRadar 콜 품질 평가 권한이 없는 계정입니다. 관리자에게 문의해 주세요.
      </p>
      {email && <p className="mt-4 text-[12px] text-[var(--fg-tertiary)]">{email}</p>}
    </div>
  );
}
