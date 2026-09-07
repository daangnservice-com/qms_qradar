import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import Providers from "./providers";
import UsageTracker from "@/components/UsageTracker";

export const metadata: Metadata = {
  title: "QRadar",
  description: "당근서비스 QRadar — 콜 품질 평가 시스템",
  // 외부 검색 완전 차단
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
  other: {
    "color-scheme": "light",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-seed data-seed-color-mode="light-only" data-ui-layout="seed" suppressHydrationWarning>
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
