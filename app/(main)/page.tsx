import { redirect } from "next/navigation";

// 랜딩 페이지는 파손 판별. 콜 품질 평가는 /call-quality(karla 전용)로 분리됨.
export default function Home() {
  redirect("/damage");
}
