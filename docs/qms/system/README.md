# 시스템 (요약)

## 사용자·권한

QRadar 사용자 식별·권한은 **이메일 기반**이다. helpdesk-x는 포크 이전 이름이다.

- 로그인: NextAuth Google OAuth → `session.user.email`
- 도메인: `ALLOWED_EMAIL_DOMAIN` (기본 `daangnservice.com`). 이 도메인이 아니면 로그인 거부.
- 기능 게이트: `lib/adminEmails.ts`(화이트리스트) + `lib/resolveAccess.ts`(Google Groups 멤버십, `lib/googleGroups.ts`). 그룹 멤버십은 로그인 세션(`session.access`)에 실린다.

| 범위 | 기준 |
|---|---|
| 평가 진행(전화·인앱 문의) | 도메인 구성원 전체 (`canAccessEvalProgress`) |
| 평가 설계 · 품질평가 | `QUALITY_EVAL_EMAILS` 또는 `QUALITY_EVAL_GROUP_EMAILS` 그룹 |
| 품질평가 > 월간 리포트 | 위 + `MONTHLY_REPORT_EMAILS` / `MONTHLY_REPORT_GROUP_EMAILS`(리더) |
| 평가 운영 | `DISTRIBUTION_FULL_EMAILS`(전체 탭), `DISTRIBUTION_ROSTER_EMAILS`(대상자 명단만) |
| 시스템(사용량·AI 평가 job·Slack 유저·sudo) | `ADMIN_EMAILS` |

- 감사 필드: 생성/수정자 기록은 **이메일 문자열** (`updated_by`, `created_by`, `analyzed_by` 등). 별도 user id 테이블 없음.

## 저장

온디맨드 읽기·쓰기는 Postgres다. BigQuery는 원천 pull과 야간 덤프다. 화면별 테이블·동기화·덤프는 [서빙 DB](serving-db.md).

## 관측

- `/eval-design/llm-usage` — LLM·STT 호출 수·토큰·latency·추정 비용. `serving_llm_call_logs`, `serving_stt_call_logs`
- `/usage` — 페이지뷰·화면별 접속·기능 사용. `serving_usage_events` (관리자)
- `/admin/eval-schedule` — 진행 중·최근 평가 job(`lib/evalSchedule.ts`, **프로세스 메모리**, 재시작 시 유실). QMS 회차·배정과 별개.
- 서버 로그 — 워치독이 `%LOCALAPPDATA%\helpdesk-x-watchdog\dev-server.log`에 줄마다 시각을 붙여 남긴다(URL 쿼리 시크릿은 `***`). `npm run logs`로 본다.
- 동기화 상태 — `serving_sync_state`에 단계별 마지막 실행·에러.
- 루트 레이아웃의 `@vercel/analytics` — 로컬 Next에서는 사실상 쓰지 않는다(정리 백로그).
