리포트 · 평가 현황 · 케이스 열람 · 월별 집계 · (후속) 내 결과.

## QRadar 구현

| 화면 | 경로 | API |
|------|------|-----|
| 리포트 | `/results/report` | `GET /api/results/report?range=3m\|6m\|12m\|all\|custom&from=&to=` |
| 평가 현황 | `/results/status` | `GET /api/results/status?month=YYYY-MM` |
| 평가 현황 UI 레퍼런스 | `/ref/eval-status` (로컬) · [eval-status-reference.html](./eval-status-reference.html) (파일 공유) | 없음 (샘플 데이터) |
| 케이스 상세 | `/results/cases` | `GET /api/results/options`, `GET /api/results/cases` |
| 월별 팀별 Cold 집계 | `/results/aggregate` | `GET /api/results/cases` (전체 1회 로드 후 클라에서 월·팀 필터) |

데이터: `growthBq.qmsCasesDetailView` / `lib/resultsStore.ts` · 미확정 트리는 Karrot `evaluations` 폴백

Sidebar 그룹명: **품질평가**

리포트 뷰: 요약 · 추이 · 조직별 · 평가표별 · 월별  
기간 칩: 최근 3/6/12개월 · 전체 · **기간 선택**(시작월~종료월)  
상단 스코어: **선택 기간**(구성원 줄 / 케이스 줄) → **최근월**(인원·Hot/Cold·팀·평가표) → Hot 추이(전사/팀별 토글)

당월 미확정: 리포트에는 미확정 평가표가 있을 때만 「미확정 평가표 존재」 배너. 누르면 `/results/status`.  
평가 현황: 월 필터(기본 당월). 팀 ▸ 템플릿 ▸ 평가표까지 기본 노출, 평가 타겟·케이스는 펼침. 케이스 클릭 시 상세 팝업. 확정 기준은 회차 `confirmed` / 대상자·케이스 `evaluated`. 집계는 `status=evaluated` + `case_status=evaluated`만.

UI 레퍼런스: 외부 공유는 `docs/qms/results/eval-status-reference.html`을 첨부하면 됩니다. 브라우저에서 파일만 열면 되고, 서버·로그인·인터넷이 필요 없습니다. 로컬에서 앱을 켠 경우에는 `/ref/eval-status`도 같습니다. 평가월 `2026-08`(미확정 섞임) · `2026-07`(전부 확정) · `2026-06`(없음).

### Hot / Cold 정의

- **Hot 비율 · Cold 비율 · Melt 비율**: `evaluation_target` 구성원 단위. 해당 월에 `result=cold`가 한 번이라도 있으면 Cold, 아니면 melt가 있으면 Melt, 나머지는 Hot. 같은 달 여러 타깃은 Cold > Melt > Hot.
- **핫 케이스 비율 · 콜드 케이스 비율**: 케이스 단위 (`case_result`, 없으면 `result`).

## 후속

공지 후 본인 결과 열람(「내 결과」) · PDF · AI 콜 결과 딥링크 · 평가자/이의 집계
