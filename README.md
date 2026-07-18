# call-quality-eval

고객 상담(CS) 콜 녹음을 업로드하면 AI가 통화 품질을 평가하고, 통화 중 공백(무음 구간)을 초 단위로 측정하는 **테스트용 사이트**.

## 개요

- **입력**: 통화 녹음 `.m4a` (10~30분+), 한 번에 한 개
- **평가 항목**: 응대 태도 / 문제 해결력 / 대화 흐름·공백 (각 1~5점)
- **결과**: 항목별 점수 + 총평 리포트 + **초 단위 공백 타임라인**
- **공백 기준**: 기본 3초 이상(화면 슬라이더로 조절)

## 아키텍처 (이중 파이프라인)

1. **ffmpeg `silencedetect`** — 신호 기반으로 무음 구간을 정확히 추출 (초 단위)
2. **Gemini 2.5 Flash** — 오디오를 직접 평가(태도/해결력/흐름), 1번의 공백 데이터를 프롬프트에 동봉해 근거 있는 코멘트 생성

## 기술 스택

- Next.js (App Router) / Tailwind CSS v4 (CSS-first)
- Google `gemini-2.5-flash` (`@google/generative-ai`)
- `ffmpeg-static` (무음 감지)

## 문서

- 기술 명세서: [`docs/superpowers/specs/2026-07-18-call-quality-eval-design.md`](docs/superpowers/specs/2026-07-18-call-quality-eval-design.md)

## 상태

설계 확정, 구현 전.
