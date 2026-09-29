import { redirect } from "next/navigation";

/** 예전 평가 진행 경로. 조회는 평가 운영 · STT 배치로 옮겼다. */
export default function SttIssuesRedirectPage() {
  redirect("/eval-ops/stt-batch/issues");
}
