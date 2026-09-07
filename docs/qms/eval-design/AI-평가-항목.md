# AI 평가 항목

레퍼런스 `data-screen-label="AI 평가 항목"`.  
사이드바에서는 **평가 설계 → 평가 항목 → AI 평가 항목** 하위 메뉴.

## UI

- 좌: 카테고리(대분류) 필터
- 중: 코드 / 항목 / 대분류 / 버전수 / 최근 버전(라벨·시각·생성자)
- 우: 버전 히스토리(업데이트 시각·생성자 이메일·최신 배지), 추가 문구, 프롬프트 필드

## 버전 라벨

저장 시 서버가 자동 생성 (Asia/Seoul):

```
YYMMDD_verN
YYMMDD_verN_{추가문구}
```

- `N` = 같은 항목·같은 날짜에 이미 있는 `ver` 최댓값 + 1
- 추가 문구는 선택(인풋). 비우면 `YYMMDD_verN` 만
- 생성자: 로그인 세션 이메일 → `updated_by`

## helpdesk-x 매핑

- API: `GET/POST /api/prompts/criteria` (`versionNote`)
- Store: `saveCriterionPrompt`, `buildCriterionVersionLabel`
- 라우트: `/eval-design/ai-items`
