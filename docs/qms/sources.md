# QMS 레퍼런스 소스

| 역할 | 경로 |
|---|---|
| **Primary UI** | `qms_ref/당근 QMS 평가시스템 설계 (0803)_haro/당근서비스 QMS.dc.html` |
| Standalone 데모 | `qms_ref/.../당근서비스 QMS (standalone).html` |
| 설계조건 명세 | `qms_ref/.../uploads/AI_QMS_개편_설계조건명세.md` |
| 이용 매뉴얼 | `qms_ref/당근_QMS_이용_매뉴얼.html` |
| 반영현황 | `qms_ref/.../QMS 설계조건 반영현황.dc.html` |
| 디자인 토큰 | `qms_ref/.../_ds_standalone/colors_and_type.css` |
| 구버전(참고만) | `qms_ref/.../uploads/AI QMS v3.dc.html` — 100점제·축소 IA |

구현 시 Primary HTML의 `data-screen-label` 단위로 화면을 맞춘다.

## 런타임 데이터

위 표는 화면 레퍼런스다. 서버가 요청 중에 읽는 저장소는 따로다.

| 역할 | 위치 |
|---|---|
| 서빙 원본 (콜·검수·인앱 문의 본문·전화 CSAT) | Postgres. [system/serving-db.md](system/serving-db.md) |
| 데이터 원천·웨어하우스 덤프 | BigQuery `ds_qradar_dev` (`BQ_TARGET=dev`)와 공유 뷰 `ds_growth_culture` |

인앱 문의 본문은 종결 후 안 바뀐다. CSAT은 완결 이후에도 도착하므로, Postgres에 넣을 때 본문과 따로 갱신한다.

## 운영 GAS (Sheets → BQ 이식 대상)

| 역할 | 경로 | 문서 |
|---|---|---|
| 대상자 선정 · 배분 시뮬레이터 | `qms_ref/Ref/qa_distribution/` | [ops-migration/qa-distribution](ops-migration/qa-distribution.md) |
| 평가 케이스 상세 · 월별 집계 | `qms_ref/Ref/qa_dashboard/` | [ops-migration/qa-dashboard](ops-migration/qa-dashboard.md) |
| 마이그레이션 인덱스 | — | [ops-migration/README](ops-migration/README.md) |
| 평가 운영 · 검수 현황 | — | [eval-ops/README](eval-ops/README.md) · [검수-현황](eval-ops/검수-현황.md) |
| 용어집 | — | [glossary](glossary.md) |
