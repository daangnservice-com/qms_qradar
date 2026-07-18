import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "통화 품질 평가",
  description: "CS 콜 녹음 품질 평가 + 공백 측정 테스트",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
