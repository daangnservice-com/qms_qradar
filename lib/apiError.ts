/**
 * 실패한 응답을 사용자에게 보여줄 상세 메시지로 변환.
 * Vercel 서버리스의 대표적 실패(타임아웃 504, 본문 초과 413)를 구체적으로 안내한다.
 */
export async function describeApiError(res: Response): Promise<string> {
  if (res.status === 504 || res.status === 502 || res.status === 503) {
    return [
      "처리 시간이 초과됐어요 (서버 타임아웃).",
      "배포 환경(Vercel)에서는 함수 실행이 60초로 제한돼, 길거나 무거운 파일은 처리 도중 끊길 수 있어요.",
      "→ 더 짧은 파일로 시도하거나, 큰 파일은 로컬(npm run dev, 제한 없음)에서 처리해 주세요.",
    ].join("\n");
  }
  if (res.status === 413) {
    return [
      "파일이 너무 커서 업로드가 거부됐어요 (413).",
      "배포 환경(Vercel)은 요청 본문이 4.5MB로 제한됩니다.",
      "→ 더 작은 파일로 시도하거나, 큰 파일은 로컬에서 처리해 주세요.",
    ].join("\n");
  }
  // 그 외: 서버가 준 JSON 에러 메시지를 우선 사용 (없으면 상태코드)
  try {
    const body = await res.json();
    if (body?.error) return String(body.error);
  } catch {
    // JSON 아님 (예: Vercel 기본 오류 페이지)
  }
  return `요청이 실패했어요 (HTTP ${res.status}). 잠시 후 다시 시도해 주세요.`;
}
