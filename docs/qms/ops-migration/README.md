# GAS → QRadar 운영 화면 마이그레이션

`qms_ref/Ref/`에 둔 Google Apps Script(GAS) 웹앱 3종을 QRadar(Next.js + SEED + BigQuery)로 이식하기 위한 인덱스다.

| GAS 프로젝트 | 제품명 | QMS IA 매핑 | 문서 |
|---|---|---|---|
| [`qa_distribution`](../../qms_ref/Ref/qa_distribution/) | 품질평가 대상자 선정 · 업무 자동배분 시뮬레이터 | **평가 운영** — 대상 · 배분 | [qa-distribution.md](qa-distribution.md) |
| [`qa_scheduler`](../../qms_ref/Ref/qa_scheduler/) | 엘리의 평가 할 일 한판 | **평가 운영** — 평가 스케줄 | [qa-scheduler.md](qa-scheduler.md) |
| [`qa_dashboard`](../../qms_ref/Ref/qa_dashboard/) | 평가 케이스 상세 대시보드 | **품질평가** — 리포트/케이스 열람 | [qa-dashboard.md](qa-dashboard.md) |

## 공통 원칙

1. **UI**: GAS HTML은 **레퍼런스만**. 화면은 QRadar **React(Next.js) + SEED**/`qms-tokens`로 재구현. iframe/정적 HTML 이식 없음.
2. **데이터**: Google Sheets → BigQuery(`ds_qradar_{dev|prod}`, `qradar_` 접두). 대시보드 케이스는 이미 공유 뷰 → **복사 없이 조회**.
3. **권한**: GAS GroupsApp + 이메일 화이트리스트 → `lib/adminEmails.ts` 확장(역할: full / roster-only / results). Google Groups 멤버십은 후속(당분간 이메일·그룹 alias 화이트리스트).
4. **비즈니스 로직**: 클라이언트 JS에 있던 배분 알고리즘·판정 규칙은 `lib/`로 이전하고 단위 테스트로 고정.
5. **점진 이식**: 읽기(BQ 조회) → 쓰기(확정/잠금) → 시뮬레이터(배분) 순. 시트와 BQ 병행 기간을 짧게 둔다.

## 사이드바 IA 제안

기존 [`00-overview.md`](../00-overview.md)의 「평가 운영」「결과」를 실제 라우트로 채운다.

```
평가 진행
  ├ 전체 평가          /call-quality
  └ 고위험군 평가      /call-quality/high-risk

평가 운영
  ├ 평가 스케줄        /eval-ops/schedule
  ├ 평가 배분          /eval-ops/assign
  │   └ 확정 배분      /eval-ops/assign?tab=assign&confirmed=1
  └ 검수 현황          /eval-ops/review-status

시스템
  └ AI 평가 job        /admin/eval-schedule   (관리자 — scheduler와 별개)

평가 설계 …
  ├ 평가 항목          /eval-design/items
  │   └ AI 평가 항목   /eval-design/ai-items
  └ …

품질평가
  ├ 리포트             /results/report
  ├ 평가 현황          /results/status
  ├ 케이스 상세        /results/cases
  └ 월별 집계          /results/aggregate

시스템 …
도움말 …
```

권한 게이트:

| 화면 | 권한 |
|---|---|
| `/call-quality*` | `CALL_QUALITY_EMAILS` |
| `/eval-ops/assign` | `roster` 이상. 일감·배분·이력 탭은 `full` |
| `/eval-ops/schedule` | 로그인 조회. 배분안 생성·월 저장은 `full` |
| `/eval-ops/review-status` | `CALL_QUALITY_EMAILS` |
| `/results/*` | `cq` 이상 (콜품질 접근자) |

## 마이그레이션 페이즈 (전체)

| Phase | 기간 감 | 산출물 |
|---|---|---|
| **P0** | 문서·스키마 | 본 폴더 문서, BQ DDL 초안, 권한 매트릭스 |
| **P1** | 데이터 적재 | Sheets → BQ 1회/정기 적재, 읽기 API |
| **P2** | 결과 대시보드 | `/results/*` SEED UI (읽기 전용) |
| **P3** | 평가 배분 | `/eval-ops/assign` 대상자 CRUD + 팀 확정 + 월 잠금 |
| **P4** | 팀·배분 | 같은 페이지 일감/평가자/배분 시뮬레이터 + 이력 확정 |
| **P4b** | 평가 스케줄 | `/eval-ops/schedule` — 캘린더·완료·개인일정 ([qa-scheduler.md](qa-scheduler.md)) |
| **P5** | GAS 폐기 | 시트 쓰기 중단, 리다이렉트/공지 |

상세 작업·시트↔테이블 매핑은 각 프로젝트 문서를 본다.

## 관련 문서

- [평가 운영 요약](../eval-ops/README.md)
- [결과 요약](../results/README.md)
- [소스 포인터](../sources.md)
- [BQ 참조](../../../lib/bqRefs.ts)
- [평가 아이템 키 통일 (dev 컷오버 2026-09-21)](eval-item-key-unification.md)
