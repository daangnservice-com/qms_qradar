# 용어집

| 용어 | 의미 |
|---|---|
| **케이스** | 1개의 컨버세이션(통화) 단위 |
| **평가 항목** | 마스터 기준(CS/직무). helpdesk-x = BQ `vw_evaluation_criterions` |
| **항목 판정** | 케이스에 대한 평가 항목 1개의 결과. 체크리스트 JSON 원소 `{id, violated, reason, evidence}` |
| **위반** | 항목 판정 중 `violated=true`. 9월부터는 **검토 필요** 플래그로 해석 (최종 Cold가 아님) |
| **수기 주석** | STT 위에 남긴 수기 검수 1건 (`eval_human_reviews` annotation). `reviewNeeded` + `judgment`(최종 Cold/Hot) |
| **고위험군 플래그** | 케이스 선별 규칙(장콜·발화비율 등). 항목 판정·위반과 다름 |
| **검수 찜하기** | 이 케이스 검수를 내가 진행 중으로 표시. 다시 누르면 취소. 찜 없이 검수 완료해도 완료자가 검수한 것으로 기록 |
| **내 평가** | 내가 수기 주석을 1건 이상 남겼거나 검수 찜한, 아직 검수 완료되지 않은 케이스 (`/call-quality/mine`) |
| **AI 평가** | STT 전사·오디오·프롬프트를 LLM에 보내 평가받는 것 (`purpose=call_eval` 또는 `qa_eval`) |
| **수기 검수** | AI 평가가 끝난 케이스를 사람이 STT 위에서 다시 평가·정정하는 것. 「검수 완료」로 확정 |
| **미탐 (FN)** | False Negative. 수기 검토필요 · AI 검토불필요 (미검출). 검토필요=positive |
| **오탐 (FP)** | False Positive. 수기 검토불필요 · AI 검토필요 (과검출) |
| 평가표 | 다회 사용 평가 기준·프롬프트 모음 **템플릿**. helpdesk-x = `template_key` + 버전 |
| 평가 세션 | **1회 평가**용 스냅샷(평가표 버전 고정 + 관련 정보). 레퍼런스 회차/스케줄 대응. UI 후속 |
| AI 평가 항목 | 항목별 프롬프트 버전(정의·사례). helpdesk-x = `llm_criterion_prompts`. 사이드바에서는 「평가 항목」 하위 |
| Gate | AI 검토필요 일치율 90% 운영 전환 기준 (Train 정확도 대시보드) |
| 검토 필요 | AI 체크리스트 위반 검출. 사람이 한 번 더 볼 대상. 콜 라벨 `review_needed` |
| 최종 Hot/Cold | 수기 감안 판정. 감안 가능=Hot, 불가=Cold. 매트릭스 축이 아님 |
| 공백(silence) | ffmpeg/STT 기반 무음·발화 간격. 프롬프트 `{{silences}}` |
| **평가셋** | (1) production으로 지정된 최종 프롬프트+스키마+바인딩 · (2) 검수 현황에서는 케이스에 쓰인 **프롬프트 버전** 비중 |
| 버전 라벨 | AI 항목 프롬프트 식별자 `YYMMDD_verN[_추가문구]` (Seoul). 생성자=`updated_by` 이메일 |
| 사용자 | Google OAuth **이메일**. 별도 user id 없음. 권한은 이메일 화이트리스트 |
| GP | 품질평가 **평가자**(Growth Partner). 배분 시뮬레이터의 배정 단위 |
| AQT | 채널별 기준 처리 시간(분). 시간 기반 배분(`AQT×건수`)에 사용 |
| 평가 대상(명단) | 월별 상담사 대상/제외 판정 목록. GAS `평가대상자` → BQ `qradar_eval_targets` |
| 월 잠금 | 전 팀 확정 후 해당 월 명단·설정을 수정 불가로 고정 |
| 배분 확정 | CS/직무 평가 업무를 GP에게 배정한 안을 history에 저장. 전월 로테이션 기준 |
| **확정 배분** | 사이드바 딥링크: 마지막 확정된 평가 배분 셋의 배분 탭 |
| **검수 현황** | 기간 내 수기 검수 완료 케이스의 오탐/미탐·matrix·항목 top·리스트 (`/eval-ops/review-status`) |
| **전체 평가** | 평가 진행 기본 화면 (`/call-quality`) |
| **고위험군 평가** | 고위험군 필터가 켜진 평가 진행 (`/call-quality/high-risk`) |
| **내 평가** | 내 수기 주석·검수 찜 미완료 큐 (`/call-quality/mine`) |
| QMS 케이스 | 사람 평가 완료 건(오답·메모·case_content). AI 콜 평가 결과와 별개 |
| Train | 수기 골드로 정확도·비교에 쓰는 레퍼런스 셋 (`qa_eval`) |
| Test | 평가 진행 운영 샘플 + 수기 검수 (`call_eval`) |
