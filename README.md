# call-quality-eval

고객 상담(CS) 콜 녹음을 업로드하면 AI가 통화 품질을 평가하고, 통화 중 공백(무음 구간)을 초 단위로 측정하는 **테스트용 사이트**.

## 개요

- **입력**: 통화 녹음 `.m4a` (10~30분+), 한 번에 한 개
- **평가 항목**: 응대 태도 / 문제 해결력 / 대화 흐름·공백 (각 1~5점)
- **결과**: 항목별 점수 + 총평 리포트 + **초 단위 공백 타임라인**
- **공백 기준**: 기본 3초 이상(화면 슬라이더로 조절)

## 아키텍처 (이중 파이프라인)

1. **ffmpeg `silencedetect`** — 신호 기반으로 무음 구간을 정확히 추출 (초 단위, 신뢰 소스)
2. **Gemini 2.5 Flash** — 오디오를 직접 평가(태도/해결력/흐름). 1번의 공백 데이터를 프롬프트에 동봉해 근거 있는 코멘트 생성. AI가 실패해도 공백 결과는 유지됨.

처리 로직은 `lib/*` 순수 모듈(HTTP 비의존)로 격리되어, 2단계에서 AWS Lambda로 그대로 이식 가능.

## 기술 스택

- Next.js 15 (App Router) / TypeScript / Tailwind CSS v4 (CSS-first)
- Google `gemini-2.5-flash` (`@google/generative-ai`)
- `ffmpeg-static` (무음 감지)
- Vitest (테스트)

## 로컬 실행

```bash
# 1) 의존성
npm install

# 2) 환경변수 (예시 복사 후 값 채우기)
cp .env.local.example .env.local
#   GEMINI_API_KEY 를 채워야 AI 평가가 동작합니다.
#   (키가 없으면 공백 측정은 되고, AI 평가는 evaluation.error 로 표시됩니다)

# 3) 개발 서버
npm run dev
# http://localhost:3000 접속 → m4a 업로드 → 결과 확인

# 테스트
npm test
```

> **참고(로컬 vs 배포)**: 로컬 `next dev`는 요청 크기/실행시간 제한이 없어 30분 파일도 동작합니다.
> Vercel(Hobby) 배포 시에는 요청 본문 4.5MB·실행 60초 제한이 걸려 **긴 파일은 실패**할 수 있습니다.
> 이 제약 해소(대용량 업로드 + 장시간 처리)는 **2단계(S3 직접 업로드 + AWS Lambda)**에서 다룹니다.

## 상태

- **1단계 (구현 완료)**: AWS 없이 Next.js 단독 동기 처리. 업로드 → ffmpeg 무음 측정 + Gemini 평가 → 결과.
- **2단계 (예정, 인프라 협의 후)**: 구글 SSO(@daangnservice.com), S3 presigned 업로드, AWS Lambda 비동기 처리.

## 문서

- 기술 명세서: [`docs/superpowers/specs/2026-07-18-call-quality-eval-design.md`](docs/superpowers/specs/2026-07-18-call-quality-eval-design.md)
- 구현 계획서: [`docs/superpowers/plans/2026-07-18-call-quality-eval.md`](docs/superpowers/plans/2026-07-18-call-quality-eval.md)
