import type {
  OutputSchemaConfig,
  OutputSchemaSnapshot,
  SchemaField,
  SchemaFieldSource,
  SchemaValueType,
} from "./promptTypes";
import { DEFAULT_OUTPUT_SCHEMA_CONFIG, DEFAULT_SCORE_FIELDS } from "./promptTypes";

export const SCHEMA_FIELD_KEY_RE = /^[a-z][a-zA-Z0-9_]*$/;

const SCORE_ITEM = {
  type: "object",
  properties: {
    score: { type: "integer" },
    comment: { type: "string" },
  },
  required: ["score", "comment"],
};

const METRIC_BOOL = {
  type: "object",
  properties: {
    value: { type: "boolean" },
    comment: { type: "string" },
  },
  required: ["value", "comment"],
};

const METRIC_PERCENT = {
  type: "object",
  properties: {
    value: { type: "number", description: "0~100 percent" },
    comment: { type: "string" },
  },
  required: ["value", "comment"],
};

const METRIC_LABEL = {
  type: "object",
  properties: {
    value: { type: "string" },
    comment: { type: "string" },
  },
  required: ["value", "comment"],
};

export function fieldValueType(f: SchemaField): SchemaValueType {
  return f.valueType ?? "score";
}

export function fieldSource(f: SchemaField): SchemaFieldSource {
  return f.source ?? "llm";
}

function sortSchemaFields(fields: SchemaField[]): SchemaField[] {
  return [...fields].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

function normalizeValueType(raw: unknown): SchemaValueType | undefined {
  const v = String(raw ?? "").trim();
  if (v === "score" || v === "percent" || v === "bool" || v === "label") return v;
  return undefined;
}

function normalizeSource(raw: unknown): SchemaFieldSource | undefined {
  const v = String(raw ?? "").trim();
  if (v === "llm" || v === "signal") return v;
  return undefined;
}

export function parseSchemaFields(raw: unknown, fallback: SchemaField[]): SchemaField[] {
  if (!Array.isArray(raw)) return fallback.map((f) => ({ ...f }));
  const out: SchemaField[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const key = String(o.key ?? "").trim();
    if (!SCHEMA_FIELD_KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    const label = String(o.label ?? key).trim() || key;
    const sortOrder = Number(o.sortOrder);
    const valueType = normalizeValueType(o.valueType);
    const source = normalizeSource(o.source);
    const definition = o.definition != null ? String(o.definition).trim() : "";
    const field: SchemaField = {
      key,
      label,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : out.length + 1,
    };
    if (valueType) field.valueType = valueType;
    if (source) field.source = source;
    if (definition) field.definition = definition;
    out.push(field);
  }
  return out;
}

/** 점수 항목. 비어 있으면 기본 3항목. */
export function resolveScoreFields(cfg: Pick<OutputSchemaConfig, "scoreFields">): SchemaField[] {
  const list = cfg.scoreFields?.length ? cfg.scoreFields : DEFAULT_SCORE_FIELDS;
  return sortSchemaFields(list);
}

/** LLM이 채울 1~5 점수 필드. */
export function resolveLlmScoreFields(cfg: Pick<OutputSchemaConfig, "scoreFields">): SchemaField[] {
  return resolveScoreFields(cfg).filter((f) => fieldSource(f) === "llm" && fieldValueType(f) === "score");
}

/** LLM이 채울 typed 메트릭(percent/bool/label). */
export function resolveLlmMetricFields(cfg: Pick<OutputSchemaConfig, "scoreFields">): SchemaField[] {
  return resolveScoreFields(cfg).filter((f) => fieldSource(f) === "llm" && fieldValueType(f) !== "score");
}

/** 신호 파이프라인이 채울 필드. */
export function resolveSignalFields(cfg: Pick<OutputSchemaConfig, "scoreFields">): SchemaField[] {
  return resolveScoreFields(cfg).filter((f) => fieldSource(f) === "signal");
}

/** 총평 필드. 비어 있으면 레거시 문자열 총평. */
export function resolveOverallSummaryFields(
  cfg: Pick<OutputSchemaConfig, "overallSummaryFields">,
): SchemaField[] {
  return sortSchemaFields(cfg.overallSummaryFields ?? []);
}

function typeHint(f: SchemaField): string {
  const t = fieldValueType(f);
  if (t === "score") return "1~5 정수 score + comment";
  if (t === "percent") return "0~100 number value + comment";
  if (t === "bool") return "boolean value + comment";
  return "string value + comment";
}

export function formatScoreItemsPrompt(cfg: Pick<OutputSchemaConfig, "scoreFields">): string {
  const llmFields = resolveScoreFields(cfg).filter((f) => fieldSource(f) === "llm");
  const signalFields = resolveSignalFields(cfg);
  const lines: string[] = [];
  llmFields.forEach((f, i) => {
    lines.push(`${i + 1}) ${f.label} (${f.key}) [${fieldValueType(f)} — ${typeHint(f)}]`);
    if (f.definition?.trim()) lines.push(`   정의: ${f.definition.trim()}`);
  });
  if (signalFields.length) {
    lines.push("");
    lines.push("시스템 계산 메트릭(응답 JSON에 넣지 마세요 — 파이프라인이 채움):");
    for (const f of signalFields) {
      lines.push(`- ${f.label} (${f.key}) [${fieldValueType(f)}]`);
      if (f.definition?.trim()) lines.push(`  ${f.definition.trim()}`);
    }
  }
  return lines.join("\n");
}

export function formatOverallFieldsPrompt(
  cfg: Pick<OutputSchemaConfig, "overallSummaryFields">,
): string {
  const fields = resolveOverallSummaryFields(cfg);
  if (!fields.length) return "overallSummary: 총평 (문자열)";
  return fields.map((f) => `- ${f.label} (${f.key})`).join("\n");
}

export function outputSchemaPromptVars(cfg: OutputSchemaConfig): {
  score_items: string;
  overall_fields: string;
} {
  return {
    score_items: cfg.includeScores ? formatScoreItemsPrompt(cfg) : "",
    overall_fields: cfg.includeOverallSummary ? formatOverallFieldsPrompt(cfg) : "",
  };
}

export function snapshotOutputSchema(cfg: OutputSchemaConfig): OutputSchemaSnapshot {
  return {
    scoreFields: cfg.includeScores ? resolveScoreFields(cfg) : [],
    overallSummaryFields: cfg.includeOverallSummary ? resolveOverallSummaryFields(cfg) : [],
  };
}

export function flattenOverallSummary(value: string | Record<string, string> | undefined | null): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return Object.values(value)
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function metricSchemaForType(t: SchemaValueType): object {
  if (t === "bool") return METRIC_BOOL;
  if (t === "percent") return METRIC_PERCENT;
  if (t === "label") return METRIC_LABEL;
  return SCORE_ITEM;
}

/** UX 설정 → Gemini responseSchema 객체 */
export function buildResponseSchemaFromConfig(cfg: OutputSchemaConfig): object {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  if (cfg.includeScores) {
    const scoreFields = resolveLlmScoreFields(cfg);
    const metricFields = resolveLlmMetricFields(cfg);

    if (scoreFields.length) {
      const scoreProps: Record<string, unknown> = {};
      const scoreReq: string[] = [];
      for (const f of scoreFields) {
        scoreProps[f.key] = SCORE_ITEM;
        scoreReq.push(f.key);
      }
      properties.scores = {
        type: "object",
        properties: scoreProps,
        required: scoreReq,
      };
      required.push("scores");
    }

    if (metricFields.length) {
      const metricProps: Record<string, unknown> = {};
      const metricReq: string[] = [];
      for (const f of metricFields) {
        metricProps[f.key] = metricSchemaForType(fieldValueType(f));
        metricReq.push(f.key);
      }
      properties.metrics = {
        type: "object",
        properties: metricProps,
        required: metricReq,
      };
      required.push("metrics");
    }
  }

  if (cfg.includeOverallSummary) {
    const fields = resolveOverallSummaryFields(cfg);
    if (fields.length) {
      const summaryProps: Record<string, unknown> = {};
      const summaryReq: string[] = [];
      for (const f of fields) {
        summaryProps[f.key] = { type: "string" };
        summaryReq.push(f.key);
      }
      properties.overallSummary = {
        type: "object",
        properties: summaryProps,
        required: summaryReq,
      };
    } else {
      properties.overallSummary = { type: "string" };
    }
    required.push("overallSummary");
  }

  if (cfg.includeSilenceComments) {
    properties.silenceComments = {
      type: "array",
      items: {
        type: "object",
        properties: {
          atSec: {
            type: "number",
            description: "Elapsed seconds from call start (e.g. 196 for 03:16). Not MM.SS like 3.16.",
          },
          note: { type: "string" },
        },
        required: ["atSec", "note"],
      },
    };
    required.push("silenceComments");
  }

  if (cfg.includeCsChecklist) {
    const itemProps: Record<string, unknown> = {};
    const itemReq: string[] = [];
    if (cfg.checklistFields.id) {
      itemProps.id = { type: "integer" };
      itemReq.push("id");
    }
    if (cfg.checklistFields.violated) {
      itemProps.violated = { type: "boolean" };
      itemReq.push("violated");
    }
    if (cfg.checklistFields.reason) {
      itemProps.reason = { type: "string" };
      itemReq.push("reason");
    }
    if (cfg.checklistFields.evidence) {
      itemProps.evidence = {
        type: "array",
        items: {
          type: "object",
          properties: {
            atSec: {
              type: "number",
              description:
                "Elapsed seconds of the agent(상담원) utterance in this scene (e.g. 196 for 03:16). Use the same agent timestamp even when quote is the customer line. Not MM.SS like 3.16.",
            },
            quote: {
              type: "string",
              description:
                "Verbatim STT with speaker prefix. Customer context: '고객: …'. Agent behavior: '상담원: …'.",
            },
          },
          required: ["atSec", "quote"],
        },
      };
    }
    properties.csChecklist = {
      type: "array",
      items: { type: "object", properties: itemProps, required: itemReq },
    };
    required.push("csChecklist");
  }

  if (cfg.includeAgentSpeakerTag) {
    properties.agentSpeakerTag = { type: "integer", nullable: true };
  }

  return { type: "object", properties, required };
}

export function parseOutputSchemaConfig(raw: unknown): OutputSchemaConfig {
  if (!raw || typeof raw !== "object") {
    return {
      ...DEFAULT_OUTPUT_SCHEMA_CONFIG,
      checklistFields: { ...DEFAULT_OUTPUT_SCHEMA_CONFIG.checklistFields },
      scoreFields: DEFAULT_SCORE_FIELDS.map((f) => ({ ...f })),
      overallSummaryFields: [],
    };
  }
  const o = raw as Record<string, unknown>;
  const cf = (o.checklistFields as Record<string, unknown>) ?? {};
  return {
    includeScores: o.includeScores !== false,
    includeOverallSummary: o.includeOverallSummary !== false,
    includeSilenceComments: o.includeSilenceComments !== false,
    includeAgentSpeakerTag: o.includeAgentSpeakerTag !== false,
    includeCsChecklist: o.includeCsChecklist !== false,
    checklistFields: {
      id: cf.id !== false,
      violated: cf.violated !== false,
      reason: cf.reason !== false,
      evidence: cf.evidence !== false,
    },
    scoreFields: parseSchemaFields(o.scoreFields, DEFAULT_SCORE_FIELDS),
    overallSummaryFields: parseSchemaFields(o.overallSummaryFields, []),
  };
}
