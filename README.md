# call-quality-eval

X팀 테스트용 사이트. 사이드바 **2탭** 구성:

1. **콜 품질 평가** — CS 콜 녹음을 올리면 AI가 품질을 평가하고 공백(무음)을 초 단위로 측정 + 전체 대화 스크립트.
2. **파손 판별 (Vision AI)** — 상품 사진을 여러 각도로 올리면 AI가 파손 여부·부위·유형을 판정(중고거래 반품/분쟁용).

---

## 탭 1 — 콜 품질 평가

### 개요

- **입력**: 통화 녹음 `.m4a` (10~30분+), 한 번에 한 개 (드래그앤드롭 또는 파일 선택)
- **평가 항목**: 응대 태도 / 문제 해결력 / 대화 흐름·공백 (각 1~5점)
- **결과**: 항목별 점수 + 총평 리포트 + **초 단위 공백 타임라인** + **전체 대화 스크립트**(화자·타임스탬프)
- **공백 기준**: 기본 3초 이상(화면 슬라이더로 조절)

## 화면

- 좌측 사이드바(**X팀** · 콜 품질 평가) + 메인 영역, Tailwind v4 기반의 정돈된 UI
- 큰 **드래그앤드롭 업로드 존** + `파일 선택` 버튼, 선택 시 파일 카드로 전환
- 결과: 점수 카드 3종 · 총평 · 공백 타임라인(스탯 타일 + 트랙) · 접이식 전체 대화 스크립트

## 아키텍처 (이중 파이프라인)

1. **ffmpeg `silencedetect`** — 신호 기반으로 무음 구간을 정확히 추출 (초 단위, 신뢰 소스)
2. **Gemini 2.5 Flash** — 오디오를 직접 평가(태도/해결력/흐름) + **전체 전사(화자 구분·타임스탬프)**. 1번의 공백 데이터를 프롬프트에 동봉해 근거 있는 코멘트 생성. AI가 실패해도 공백 결과는 유지됨.

처리 로직은 `lib/*` 순수 모듈(HTTP 비의존)로 격리되어, 2단계에서 AWS Lambda로 그대로 이식 가능.

> **정밀도 참고**: 공백 타임라인은 ffmpeg 신호 기반이라 초 단위로 정확하고, 전사 타임스탬프는 Gemini 추정치라 근사값입니다.

---

## 탭 2 — 파손 판별 (Vision AI)

### 개요

- **입력**: 상품 사진 `.jpg/.png/.webp`, 1~8장 (한 상품의 여러 각도, 드래그앤드롭 또는 파일 선택)
- **판정**: **파손됨 / 정상 / 불확실** + 신뢰도(%)
- **결과**: 판정 배지 + 종합 소견 + 파손 근거(부위·유형·설명) + 사진별 코멘트(썸네일)
- **용도**: 중고거래 반품/분쟁 판정 근거

### 동작

- 여러 사진을 **한 번의 Gemini 호출**에 함께 넣어(한 상품의 여러 각도) 종합 판정. 사물 종류와 무관하게 물리적 손상 판별.
- 이미지는 **Gemini File API 업로드**(원본 해상도 유지 → 미세한 긁힘/흠집까지). 판정 후 업로드 파일 정리.
- 판정 로직은 `lib/vision.ts` 순수 모듈(HTTP 비의존)로 격리 → 2단계 이식 대비.

> **HEIC 미지원(1단계)**: 아이폰 기본 HEIC는 Gemini가 직접 못 받아 제외. jpg/png/webp로 올려주세요.

---

## 기술 스택

- Next.js 15 (App Router) / TypeScript / Tailwind CSS v4 (CSS-first)
- Google `gemini-2.5-flash` (`@google/generative-ai`) — 오디오·이미지 File API
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

- **1단계 (구현 완료)**: AWS 없이 Next.js 단독 동기 처리. 콜 품질 평가 + 파손 판별 두 탭. UI 정돈 완료.
- **2단계 (예정, 인프라 협의 후)**: 구글 SSO(@daangnservice.com), S3 presigned 업로드, AWS Lambda 비동기 처리.

## 문서

**콜 품질 평가**
- 기술 명세서: [`docs/superpowers/specs/2026-07-18-call-quality-eval-design.md`](docs/superpowers/specs/2026-07-18-call-quality-eval-design.md)
- 구현 계획서: [`docs/superpowers/plans/2026-07-18-call-quality-eval.md`](docs/superpowers/plans/2026-07-18-call-quality-eval.md)

**파손 판별**
- 기술 명세서: [`docs/superpowers/specs/2026-07-19-damage-detection-design.md`](docs/superpowers/specs/2026-07-19-damage-detection-design.md)
- 구현 계획서: [`docs/superpowers/plans/2026-07-19-damage-detection.md`](docs/superpowers/plans/2026-07-19-damage-detection.md)

**개발일지**
- [`docs/devlog/2026-07-18_개발일지.md`](docs/devlog/2026-07-18_개발일지.md) — 콜 품질 평가
- [`docs/devlog/2026-07-19_개발일지.md`](docs/devlog/2026-07-19_개발일지.md) — 파손 판별 + 박스 오버레이
