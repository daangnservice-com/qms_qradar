# AI 비교·개선

레퍼런스 AI 비교·개선 화면.

## UI

- 샘플/케이스 리스트 + 우측 상세
- 항목별 TP/FP/FN/TN
- AI 평가 실행 CTA
- 불일치 북마크(1차)

## helpdesk-x 매핑

- API: `/api/qa/samples`, `/api/qa/compare`, `/api/qa/evaluate`
- 라우트: `/eval-design/compare`
- Train 소스·파생 테이블: [train-reference-lineage.md](./train-reference-lineage.md)

## Train 필터

- 뷰: `QA_REFERENCES_VIEW` (전화채널 멀티팀; 뷰명에 pay가 남아 있을 수 있음)
- `year_month >= QA_REFERENCES_MIN_YEAR_MONTH` (기본 `2026-06-01`) — 그 이전 score_detail criterion id 체계 제외
