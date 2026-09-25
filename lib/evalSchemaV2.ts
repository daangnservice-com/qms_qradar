/** v2 물리 스키마. 마이그레이션 CREATE 와 ensure() 가 공유한다. */

export type BqField = { name: string; type: string; mode: string };

export const EVAL_RESULTS_V2_SCHEMA: BqField[] = [
  { name: "analysis_id", type: "STRING", mode: "REQUIRED" },
  { name: "analyzed_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "channel", type: "STRING", mode: "REQUIRED" },
  { name: "source_system", type: "STRING", mode: "REQUIRED" },
  { name: "source_id", type: "STRING", mode: "REQUIRED" },
  { name: "org", type: "STRING", mode: "NULLABLE" },
  { name: "purpose", type: "STRING", mode: "REQUIRED" },
  { name: "analyzed_by", type: "STRING", mode: "NULLABLE" },
  { name: "model", type: "STRING", mode: "NULLABLE" },
  { name: "prompt_version_id", type: "STRING", mode: "NULLABLE" },
  { name: "prompt_version", type: "STRING", mode: "NULLABLE" },
  { name: "ai_label", type: "STRING", mode: "NULLABLE" },
  { name: "turns_json", type: "STRING", mode: "NULLABLE" },
  { name: "input_snapshot_json", type: "STRING", mode: "NULLABLE" },
  { name: "channel_attrs_json", type: "STRING", mode: "NULLABLE" },
  { name: "result_json", type: "STRING", mode: "REQUIRED" },
  { name: "llm_call_id", type: "STRING", mode: "NULLABLE" },
  { name: "error", type: "STRING", mode: "NULLABLE" },
];

export const EVAL_HUMAN_REVIEWS_V2_SCHEMA: BqField[] = [
  { name: "annotation_id", type: "STRING", mode: "REQUIRED" },
  { name: "channel", type: "STRING", mode: "REQUIRED" },
  { name: "source_system", type: "STRING", mode: "REQUIRED" },
  { name: "source_id", type: "STRING", mode: "REQUIRED" },
  { name: "criterion_id", type: "INTEGER", mode: "NULLABLE" },
  { name: "scope", type: "STRING", mode: "NULLABLE" },
  { name: "judgment", type: "STRING", mode: "NULLABLE" },
  { name: "review_needed", type: "BOOLEAN", mode: "NULLABLE" },
  { name: "best_category", type: "STRING", mode: "NULLABLE" },
  { name: "source", type: "STRING", mode: "NULLABLE" },
  { name: "at_sec", type: "FLOAT", mode: "NULLABLE" },
  { name: "segment_index", type: "INTEGER", mode: "NULLABLE" },
  { name: "turn_id", type: "STRING", mode: "NULLABLE" },
  { name: "comment", type: "STRING", mode: "NULLABLE" },
  { name: "quote", type: "STRING", mode: "NULLABLE" },
  { name: "ai_criterion_id", type: "INTEGER", mode: "NULLABLE" },
  { name: "ai_violated", type: "BOOLEAN", mode: "NULLABLE" },
  { name: "ai_quote", type: "STRING", mode: "NULLABLE" },
  { name: "ai_reason", type: "STRING", mode: "NULLABLE" },
  { name: "payload_json", type: "STRING", mode: "NULLABLE" },
  { name: "updated_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "updated_by", type: "STRING", mode: "NULLABLE" },
  { name: "deleted", type: "BOOLEAN", mode: "NULLABLE" },
];

export const EVAL_REVIEW_COMPLETIONS_V2_SCHEMA: BqField[] = [
  { name: "channel", type: "STRING", mode: "REQUIRED" },
  { name: "source_system", type: "STRING", mode: "REQUIRED" },
  { name: "source_id", type: "STRING", mode: "REQUIRED" },
  { name: "completed_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "completed_by", type: "STRING", mode: "REQUIRED" },
  { name: "analysis_id", type: "STRING", mode: "NULLABLE" },
  { name: "org", type: "STRING", mode: "NULLABLE" },
];

export const EVAL_REVIEW_CLAIMS_V2_SCHEMA: BqField[] = [
  { name: "channel", type: "STRING", mode: "REQUIRED" },
  { name: "source_system", type: "STRING", mode: "REQUIRED" },
  { name: "source_id", type: "STRING", mode: "REQUIRED" },
  { name: "claimed_by", type: "STRING", mode: "REQUIRED" },
  { name: "claimed_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "active", type: "BOOLEAN", mode: "REQUIRED" },
];
