"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { LogIn, Radar } from "lucide-react";

export default function LoginPage() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-subtle)] px-6">
      <div className="w-full max-w-sm rounded-[20px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-8 text-center shadow-[0_12px_40px_rgba(26,26,25,0.06)]">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-subtle)]">
          <Radar className="h-7 w-7 text-[var(--brand)]" strokeWidth={2.2} />
        </div>
        <h1 className="text-[22px] font-bold tracking-tight text-[var(--fg-primary)]">QRadar</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--fg-secondary)]">
          당근서비스 콜 품질 평가 시스템
        </p>

        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/" })}
          disabled={status === "loading"}
          className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-[var(--brand)] px-5 py-3.5 text-[15px] font-bold text-white shadow-sm transition hover:bg-[var(--brand-hover)] disabled:opacity-50"
        >
          <LogIn className="h-4 w-4" />
          구글로 로그인
        </button>

        <p className="mt-4 text-[12px] text-[var(--fg-tertiary)]">@daangnservice.com 계정만 로그인할 수 있어요</p>
      </div>
    </div>
  );
}
