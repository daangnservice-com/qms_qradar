"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { BookOpen, LogIn } from "lucide-react";

export default function LoginPage() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10">
          <BookOpen className="h-6 w-6 text-brand" strokeWidth={2.2} />
        </div>
        <h1 className="text-lg font-bold tracking-tight text-gray-900">X팀</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">
          X팀이 현재 개발중인 테스트 페이지입니다.
        </p>

        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/" })}
          disabled={status === "loading"}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-navy px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-hover disabled:opacity-50"
        >
          <LogIn className="h-4 w-4" />
          구글로 로그인
        </button>

        <p className="mt-4 text-xs text-gray-400">@daangnservice.com 계정만 로그인할 수 있어요</p>
      </div>
    </div>
  );
}
