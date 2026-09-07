/** 오디오·신호 분석 파이프라인 설정 (평가셋에 바인딩) */

export type InjectPromptVar = "silences" | "silence_summary" | "stt_script" | "overlaps";

export type AudioPipelineStepId =
  | "silence_ffmpeg"
  | "speech_gaps_stt"
  | "overlap_ffmpeg"
  | "inject_prompt_vars"
  | "gemini_audio_file"
  | "schema_silence_comments";

export interface AudioPipelineStep {
  id: AudioPipelineStepId;
  enabled: boolean;
  /** silence_ffmpeg / overlap_ffmpeg */
  minSilenceSec?: number;
  noiseDb?: number;
  /** speech_gaps_stt / overlap: STT 결과가 있으면 ffmpeg 결과 대체 */
  preferOverFfmpeg?: boolean;
  /** inject_prompt_vars */
  vars?: InjectPromptVar[];
}

export interface AudioPipelineConfig {
  steps: AudioPipelineStep[];
}

export const DEFAULT_INJECT_VARS: InjectPromptVar[] = [
  "silences",
  "silence_summary",
  "stt_script",
  "overlaps",
];

export const DEFAULT_AUDIO_PIPELINE_CONFIG: AudioPipelineConfig = {
  steps: [
    { id: "silence_ffmpeg", enabled: true, minSilenceSec: 3, noiseDb: -30 },
    { id: "speech_gaps_stt", enabled: true, preferOverFfmpeg: true },
    { id: "overlap_ffmpeg", enabled: true, noiseDb: -30, preferOverFfmpeg: true },
    {
      id: "inject_prompt_vars",
      enabled: true,
      vars: [...DEFAULT_INJECT_VARS],
    },
    { id: "gemini_audio_file", enabled: true },
    { id: "schema_silence_comments", enabled: true },
  ],
};

/** 텍스트 채널은 오디오 파이프라인을 실행하거나 저장하지 않는다. */
export const TEXT_AUDIO_PIPELINE_CONFIG: AudioPipelineConfig = {
  steps: DEFAULT_AUDIO_PIPELINE_CONFIG.steps.map((step) => ({
    ...step,
    enabled: false,
    ...(step.id === "inject_prompt_vars" ? { vars: [] } : {}),
  })),
};

const INJECT_VAR_SET = new Set<string>(DEFAULT_INJECT_VARS);

function parseInjectVars(raw: unknown, fallback: InjectPromptVar[]): InjectPromptVar[] {
  if (!Array.isArray(raw)) return [...fallback];
  const out = raw.filter((v): v is InjectPromptVar => typeof v === "string" && INJECT_VAR_SET.has(v));
  return out;
}

export function parseAudioPipelineConfig(raw: unknown): AudioPipelineConfig {
  if (!raw || typeof raw !== "object") return structuredClone(DEFAULT_AUDIO_PIPELINE_CONFIG);
  const o = raw as { steps?: unknown };
  if (!Array.isArray(o.steps) || !o.steps.length) {
    return structuredClone(DEFAULT_AUDIO_PIPELINE_CONFIG);
  }
  const defaults = new Map(DEFAULT_AUDIO_PIPELINE_CONFIG.steps.map((s) => [s.id, s]));
  const steps: AudioPipelineStep[] = [];
  for (const s of o.steps) {
    if (!s || typeof s !== "object") continue;
    const row = s as Record<string, unknown>;
    const id = String(row.id) as AudioPipelineStepId;
    if (!defaults.has(id)) continue;
    const base = defaults.get(id)!;
    steps.push({
      ...base,
      enabled: row.enabled !== false,
      minSilenceSec: row.minSilenceSec != null ? Number(row.minSilenceSec) : base.minSilenceSec,
      noiseDb: row.noiseDb != null ? Number(row.noiseDb) : base.noiseDb,
      preferOverFfmpeg: row.preferOverFfmpeg !== false,
      vars: id === "inject_prompt_vars" ? parseInjectVars(row.vars, base.vars ?? DEFAULT_INJECT_VARS) : base.vars,
    });
  }
  for (const [id, base] of defaults) {
    if (!steps.find((s) => s.id === id)) steps.push({ ...base });
  }
  return { steps };
}

export function getAudioStep(
  cfg: AudioPipelineConfig | null | undefined,
  id: AudioPipelineStepId,
): AudioPipelineStep {
  const c = cfg ?? DEFAULT_AUDIO_PIPELINE_CONFIG;
  return c.steps.find((s) => s.id === id) ?? DEFAULT_AUDIO_PIPELINE_CONFIG.steps.find((s) => s.id === id)!;
}

export function isAudioStepEnabled(
  cfg: AudioPipelineConfig | null | undefined,
  id: AudioPipelineStepId,
): boolean {
  return getAudioStep(cfg, id).enabled !== false;
}

/** inject_prompt_vars 에 실제로 켜진 변수 집합 */
export function getInjectVars(cfg: AudioPipelineConfig | null | undefined): Set<InjectPromptVar> {
  const step = getAudioStep(cfg, "inject_prompt_vars");
  if (step.enabled === false) return new Set();
  // vars=[] 는 “전부 끔” — 미지정(undefined)만 기본값
  if (step.vars == null) return new Set(DEFAULT_INJECT_VARS);
  return new Set(step.vars);
}

export const INJECT_VAR_LABELS: Record<InjectPromptVar, { title: string; desc: string }> = {
  silences: { title: "사일런스", desc: "{{silences}} + {{silence_summary}}" },
  silence_summary: { title: "사일런스 요약", desc: "{{silence_summary}}" },
  stt_script: { title: "STT 스크립트", desc: "{{stt_script}}" },
  overlaps: { title: "말 겹침 구간", desc: "{{overlaps}}" },
};

export const AUDIO_STEP_LABELS: Record<AudioPipelineStepId, { title: string; desc: string }> = {
  silence_ffmpeg: {
    title: "ffmpeg 공백 감지",
    desc: "신호 기반 silencedetect (noiseDb / minSilenceSec)",
  },
  speech_gaps_stt: {
    title: "STT 발화 간격",
    desc: "전사 세그먼트 사이 공백으로 대체(우선)",
  },
  overlap_ffmpeg: {
    title: "ffmpeg 말 겹침",
    desc: "스테레오 좌·우 동시 발화 구간 (STT 있으면 우선 대체 가능)",
  },
  inject_prompt_vars: {
    title: "프롬프트 변수 주입",
    desc: "선택한 변수만 프롬프트에 넣고, 관련 파이프라인만 실행",
  },
  gemini_audio_file: {
    title: "Gemini 오디오 첨부",
    desc: "멀티모달 File API로 원본 녹음 전달",
  },
  schema_silence_comments: {
    title: "silenceComments 스키마",
    desc: "응답 JSON에 공백 코멘트 필드 포함",
  },
};
