// 콜 스크립트 등 표시/저장 텍스트에서 개인정보(PII)를 정규식으로 마스킹한다.
// - 대상: 이메일, 카드번호(16), 주민등록번호(13), 전화번호(휴대폰/지역). 번호류 중심.
// - 한계: 이름·주소 등 문맥 의존 PII는 규칙으로 못 잡음(오디오엔 남아 있음). 필요 시 NER/DLP로 확장.
// - 멱등: 이미 가려진 값(*)은 재매칭되지 않으므로, 저장분에 다시 돌려도 안전(표시+저장 이중 적용 대비).
// 순서 주의: 자릿수 많은 것(카드16 > 주민13) 먼저 마스킹해야 전화번호 규칙이 부분 삼키는 것을 막는다.

// 이메일: 로컬 첫 글자만 남기고 마스킹
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
// 카드번호(16자리, 구분자 - 또는 공백 허용): 앞4·뒤4만 남김
const CARD = /\b(\d{4})[-\s]?\d{4}[-\s]?\d{4}[-\s]?(\d{4})\b/g;
// 주민등록번호(생년월일6 + 성별/일련7): 뒤 7자리 전부 마스킹
const RRN = /\b(\d{6})[-\s]?[1-8]\d{6}\b/g;
// 전화번호(휴대폰 010 등 / 지역번호 0X): 뒤 4자리만 남김
const PHONE = /\b(0\d{1,2})[-\s]?\d{3,4}[-\s]?(\d{4})\b/g;

export function maskPII(text: string): string {
  if (!text) return text;
  return text
    .replace(EMAIL, (_m, first: string, domain: string) => `${first}***@${domain}`)
    .replace(CARD, (_m, f: string, l: string) => `${f}-****-****-${l}`)
    .replace(RRN, (_m, front: string) => `${front}-*******`)
    .replace(PHONE, (_m, a: string, d: string) => `${a}-****-${d}`);
}
