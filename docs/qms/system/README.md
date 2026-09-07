# 시스템 (요약)

## 사용자·권한

helpdesk-x 사용자 식별·권한은 **이메일 기반**이다.

- 로그인: NextAuth Google OAuth → `session.user.email`
- 도메인: `ALLOWED_EMAIL_DOMAIN` (기본 `daangnservice.com`)
- 기능 게이트: `lib/adminEmails.ts` 화이트리스트
  - `ADMIN_EMAILS` — `/usage`, `/admin/eval-schedule` 및 관련 API
  - `CALL_QUALITY_EMAILS` — 콜 품질(현재 운영 UI는 `/call-quality`).
  - `canAccessAnyCallQuality` — 평가 설계(QMS) `/eval-design/*`
- 감사 필드: 생성/수정자 기록은 **이메일 문자열** (`updated_by`, `created_by`, `analyzed_by` 등). 별도 user id 테이블 없음.

## 관측

- `/eval-design/llm-usage` — LLM 토큰·latency·추정 비용 (`llm_call_logs`)
- `/usage` — 페이지뷰·화면별 접속 (`qradar_usage_events`, 관리자)
- `/admin/eval-schedule` — 진행 중·최근 평가 job(`lib/evalSchedule.ts`, **프로세스 메모리**, 재시작 시 유실). QMS 회차·배정과 별개.
- 루트 레이아웃의 `@vercel/analytics` — EC2에서도 로드되나 서버리스 전제 지표와는 별개(정리 백로그).
