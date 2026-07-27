/**
 * 실패한 응답을 사용자에게 보여줄 상세 메시지로 변환.
 * 배포는 사내 EC2(Docker standalone) + ALB이며, 앱 자체엔 실행시간 제한이 없다.
 * 5xx 게이트웨이 오류는 앞단(로드밸런서)이 끊었거나 컨테이너가 내려간 경우다.
 */
export async function describeApiError(res: Response): Promise<string> {
  if (res.status === 504 || res.status === 502 || res.status === 503) {
    return [
      "요청이 중간에 끊겼어요 (게이트웨이 오류).",
      "서버가 재시작 중이거나 앞단 로드밸런서가 연결을 끊은 경우예요.",
      "→ 잠시 후 다시 시도해 주세요. 계속 반복되면 개발자에게 알려주세요.",
    ].join("\n");
  }
  if (res.status === 413) {
    return [
      "요청이 너무 커서 거부됐어요 (413).",
      "→ 이미지 장수를 줄이거나 용량이 작은 파일로 다시 시도해 주세요.",
    ].join("\n");
  }
  // 그 외: 서버가 준 JSON 에러 메시지를 우선 사용 (없으면 상태코드)
  try {
    const body = await res.json();
    if (body?.error) return String(body.error);
  } catch {
    // JSON 아님 (예: 프록시가 만든 기본 오류 페이지)
  }
  return `요청이 실패했어요 (HTTP ${res.status}). 잠시 후 다시 시도해 주세요.`;
}
