import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import Providers from "./providers";
import UsageTracker from "@/components/UsageTracker";

export const metadata: Metadata = {
  title: "X팀 헬프데스크",
  description: "X팀 내부 헬프데스크",
  // 외부 검색 완전 차단
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Providers>
          <UsageTracker />
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
