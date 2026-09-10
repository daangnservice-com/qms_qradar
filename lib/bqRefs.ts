// BigQuery 프로젝트·데이터셋·테이블/뷰 참조 한곳 모음.
//
// ┌────────────────────────────────────────────────────────────────┐
// │  전환 스위치                                                    │
// │  - env:  BQ_TARGET=dev | prod                                   │
// │  - 또는 아래 BQ_TARGET_DEFAULT 변경                              │
// │  → 앱이 쓰는 적재 데이터셋만 갈림 (테이블명은 동일, qradar_ 접두)  │
// │                                                                │
// │  dev  → data-proj-470202.ds_qradar_dev                          │
// │  prod → data-proj-470202.ds_qradar_prod                         │
// │                                                                │
// │  입력(공유): cases / criteria 뷰는 ds_growth_culture 유지        │
// └────────────────────────────────────────────────────────────────┘
//
// env가 있으면 env 우선.

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v.trim() !== "" ? v.trim() : fallback;
}

function envOpt(name: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v.trim() !== "" ? v.trim() : undefined;
}

function fq(projectId: string, dataset: string, table: string): string {
  return `${projectId}.${dataset}.${table}`;
}

function sqlFq(projectId: string, dataset: string, table: string): string {
  return `\`${fq(projectId, dataset, table)}\``;
}

// ─── 타겟 스위치 ─────────────────────────────────────────────────
export type BqTarget = "prod" | "dev";
/** 코드에서 바로 바꿀 때. env `BQ_TARGET`가 있으면 그쪽이 이긴다. */
const BQ_TARGET_DEFAULT: BqTarget = "prod";
export const BQ_TARGET: BqTarget = env("BQ_TARGET", BQ_TARGET_DEFAULT) === "dev" ? "dev" : "prod";

/** true면 개발 데이터셋(ds_qradar_dev) 사용. */
export const isBqDev = BQ_TARGET === "dev";

/**
 * @deprecated `_dev` 테이블 접미는 폐기. 동일 이름을 그대로 반환(하위호환).
 * 새 코드는 `qradarTable()` 사용.
 */
export function bqOut(baseName: string): string {
  return baseName;
}

/** 논리 테이블명 → `qradar_` 접두 테이블명. 이미 접두가 있으면 그대로. */
export function qradarTable(baseName: string): string {
  const bare = baseName.replace(/_dev$/, "");
  return bare.startsWith("qradar_") ? bare : `qradar_${bare}`;
}

// ─── 공통 프로젝트 ───────────────────────────────────────────────
const PROJECT = env(
  "GROWTH_CULTURE_PROJECT_ID",
  env("GOOGLE_CLOUD_PROJECT_ID", "data-proj-470202"),
);

/** 공유 입력(케이스·기준 뷰)이 있는 데이터셋 — 타겟과 무관. */
const SHARED_DATASET = env("EVAL_SHARED_DATASET", env("EVAL_RESULTS_DATASET", "ds_growth_culture"));
const SHARED_LOCATION = envOpt("GROWTH_CULTURE_LOCATION"); // 미설정 → auto-detect

/** 앱 적재 데이터셋: 타겟별 분리. env `QRADAR_DATASET`로 강제 오버라이드 가능. */
const QRADAR_DATASET_DEFAULT = BQ_TARGET === "dev" ? "ds_qradar_dev" : "ds_qradar_prod";
const QRADAR_DATASET = env("QRADAR_DATASET", QRADAR_DATASET_DEFAULT);
// 과거 BIGQUERY_DATASET_ID / PROMPT_BQ_DATASET 는 적재 데이터셋 오버라이드로 취급(있으면 QRADAR 보다 약함 — QRADAR_DATASET 우선)
const QRADAR_LOCATION = env(
  "QRADAR_LOCATION",
  env("BIGQUERY_LOCATION", env("PROMPT_BQ_LOCATION", SHARED_LOCATION ?? "US")),
);

// ─── 앱 로그 (usage) ─────────────────────────────────────────────
export const appBq = {
  projectId: PROJECT,
  dataset: QRADAR_DATASET,
  location: QRADAR_LOCATION,
  tables: {
    usageEvents: qradarTable("usage_events"),
  },
  fq: (table: string) => fq(PROJECT, QRADAR_DATASET, table),
  sql: (table: string) => sqlFq(PROJECT, QRADAR_DATASET, table),
} as const;

// ─── 프롬프트/템플릿 관리 ─────────────────────────────────────────
export const promptBq = {
  projectId: PROJECT,
  dataset: QRADAR_DATASET,
  location: QRADAR_LOCATION,
  tables: {
    versions: qradarTable("llm_prompt_versions"),
    prodHistory: qradarTable("llm_prompt_prod_history"),
    criterionPrompts: qradarTable("llm_criterion_prompts"),
    fieldConfig: qradarTable("llm_prompt_field_config"),
    highRiskFlagRules: qradarTable("high_risk_flag_rules"),
    /** 장콜 상위 N% 임계분(직전 7일 MA) 스냅샷 */
    longCallThresholds: qradarTable("long_call_thresholds"),
  },
  fq: (table: string) => fq(PROJECT, QRADAR_DATASET, table),
  sql: (table: string) => sqlFq(PROJECT, QRADAR_DATASET, table),
} as const;

// ─── 콜 평가 (입력=공유 데이터셋, 결과=qradar 데이터셋) ───────────
const CASES_DATASET_TABLE = env("EVAL_CASES_TABLE", `${SHARED_DATASET}.qradar_evaluation_cases`);
/** 통합 AI 평가 결과 (call_eval + qa_eval). org 컬럼으로 growth/pay 구분. */
const RESULTS_TABLE = qradarTable(env("EVAL_RESULTS_TABLE", "qradar_evaluation_results"));
/** @deprecated pay도 통합 테이블 org='pay' 사용. 하위호환 별칭. */
const RESULTS_TABLE_PAY = RESULTS_TABLE;
const CRITERIA_VIEW = env("EVAL_CRITERIA_VIEW", `${SHARED_DATASET}.vw_evaluation_criterions`);
/**
 * 수기 평가 완료 레퍼런스(Train). 뷰 이름에 pay가 남아 있어도
 * 현재는 전화채널 전반(페이·알바·광고 등) 포함. 스키마: year_month, score_detail, …
 */
const QA_REFERENCES_VIEW = env(
  "QA_REFERENCES_VIEW",
  `${SHARED_DATASET}.vw_qradar_evaluation_case_references_pay_phone_inquries`,
);
/**
 * Train 레퍼런스 최소 year_month (YYYY-MM-01).
 * 6월 이전 score_detail 은 현재 criterion id 체계와 달라 제외.
 */
const QA_REFERENCES_MIN_YEAR_MONTH = env("QA_REFERENCES_MIN_YEAR_MONTH", "2026-06-01");
/**
 * QMS 사람 평가 케이스 상세(결과 대시보드). GAS qa_dashboard 시트 `data` 원천.
 * 공유 데이터셋 뷰 — qradar로 복사하지 않고 직접 조회.
 */
const QMS_CASES_DETAIL_VIEW = env(
  "QMS_CASES_DETAIL_VIEW",
  `${SHARED_DATASET}.vw_quality_evaluation_cases_detail_with_fallback`,
);

export const growthBq = {
  projectId: PROJECT,
  /** 결과·QA·LLM 로그가 적재되는 데이터셋 (= qradar target) */
  dataset: QRADAR_DATASET,
  /** 공유 입력 데이터셋 (cases / criteria) */
  sharedDataset: SHARED_DATASET,
  location: QRADAR_LOCATION,
  sharedLocation: SHARED_LOCATION,
  casesDatasetTable: CASES_DATASET_TABLE,
  resultsTable: RESULTS_TABLE,
  /** @deprecated 통합 테이블과 동일 */
  resultsTablePay: RESULTS_TABLE_PAY,
  /** @deprecated QA도 resultsTable(purpose=qa_eval). 별칭 유지 */
  qaEvalResults: RESULTS_TABLE,
  llmCallLogs: qradarTable("llm_call_logs"),
  sttCallLogs: qradarTable("stt_call_logs"),
  evalHumanReviews: qradarTable("eval_human_reviews"),
  evalReviewClaims: qradarTable("eval_review_claims"),
  /** 수기 검수 완료 이벤트 (얇은 append — 결과 JSON 복사 없음) */
  evalReviewCompletions: qradarTable("eval_review_completions"),
  /** 평가셋과 평가 기준의 정규화된 연결 */
  evalSetCriteria: qradarTable("eval_set_criteria"),
  /** 평가 실행별 기준 판정 결과 */
  evalCriterionResults: qradarTable("evaluation_criterion_results"),
  /**
   * CS 체크리스트 기준 뷰(`dataset.view`). 빈 문자열이면 BQ 조회 스킵 → 하드코딩.
   * 컬럼: id, type, parent_name, name, parent_id, extra, …
   */
  criteriaView: CRITERIA_VIEW,
  /**
   * 수기 평가 완료 레퍼런스(Train). 전화채널 멀티팀.
   * 뷰명에 pay가 남아 있을 수 있음 — 내용은 QA_REFERENCES_VIEW 주석 참고.
   */
  qaReferencesView: QA_REFERENCES_VIEW,
  /** Train 포함 최소 year_month (DATE 'YYYY-MM-01') */
  qaReferencesMinYearMonth: QA_REFERENCES_MIN_YEAR_MONTH,
  /** 결과 대시보드(케이스 상세·Cold 집계) 원천 뷰 */
  qmsCasesDetailView: QMS_CASES_DETAIL_VIEW,
  casesSql: () => `\`${PROJECT}.${CASES_DATASET_TABLE}\``,
  resultsSql: (table: string) => sqlFq(PROJECT, QRADAR_DATASET, table),
  resultsFq: (table: string) => fq(PROJECT, QRADAR_DATASET, table),
  criteriaSql: () => (CRITERIA_VIEW ? `\`${PROJECT}.${CRITERIA_VIEW}\`` : null),
  qaReferencesSql: () => (QA_REFERENCES_VIEW ? `\`${PROJECT}.${QA_REFERENCES_VIEW}\`` : null),
  qmsCasesDetailSql: () =>
    QMS_CASES_DETAIL_VIEW ? `\`${PROJECT}.${QMS_CASES_DETAIL_VIEW}\`` : null,
} as const;

/**
 * Karrot CS 평가 원천 (evaluations ▸ targets ▸ cases).
 * 품질평가 리포트 「당월 미확정」은 뷰가 아직 evaluated만 줄 때 여기로 조회.
 * 뷰에 evaluation_status를 넣고 status 필터를 빼면 뷰 경로로 전환.
 */
const KARROT_CS_PROJECT = env("KARROT_CS_PROJECT", "karrotmarket");
const KARROT_CS_DATASET = env("KARROT_CS_DATASET", "db_karrot_cs_kr");
const FEEDBACK_SOURCE_VIEW = env(
  "FEEDBACK_SOURCE_VIEW",
  "team_operation.vw_feedback_thread_aggregation",
);

export const karrotCsBq = {
  projectId: KARROT_CS_PROJECT,
  dataset: KARROT_CS_DATASET,
  sql: (table: string) => `\`${KARROT_CS_PROJECT}.${KARROT_CS_DATASET}.${table}\``,
} as const;

/** 인앱 문의(feedback) 원천. 집계 뷰라서 앱에서 무제한 조회하지 않는다. */
export const feedbackBq = {
  projectId: env("FEEDBACK_PROJECT", KARROT_CS_PROJECT),
  location: envOpt("FEEDBACK_LOCATION") ?? "US",
  sourceView: FEEDBACK_SOURCE_VIEW,
  sourceSql: () => `\`${env("FEEDBACK_PROJECT", KARROT_CS_PROJECT)}.${FEEDBACK_SOURCE_VIEW}\``,
  snapshotTable: qradarTable(env("FEEDBACK_SNAPSHOT_TABLE", "evaluation_feedback_items")),
} as const;

/**
 * CSAT(고객 설문) 원천. 전화 문의는 inquiry_type='PhoneInquiry' + inquiry_id = 상담이력 ID로 매핑.
 * 중복 응답이 섞여 있어 항상 dup_no = 1만 쓴다.
 * choices 테이블은 choice_* 컬럼의 한글 라벨 사전(거의 바뀌지 않음).
 */
const CSAT_RAWLOG_VIEW = env(
  "CSAT_RAWLOG_VIEW",
  "team_operation.vw_feedback_chat_CSAT_rawlog_verbose",
);
const CSAT_CHOICES_TABLE = env(
  "CSAT_CHOICES_TABLE",
  "team_operation.utility_inquiry_ratings_choices",
);
const CSAT_PROJECT = env("CSAT_PROJECT", KARROT_CS_PROJECT);

export const csatBq = {
  projectId: CSAT_PROJECT,
  location: envOpt("CSAT_LOCATION") ?? "US",
  rawlogView: CSAT_RAWLOG_VIEW,
  choicesTable: CSAT_CHOICES_TABLE,
  rawlogSql: () => `\`${CSAT_PROJECT}.${CSAT_RAWLOG_VIEW}\``,
  choicesSql: () => `\`${CSAT_PROJECT}.${CSAT_CHOICES_TABLE}\``,
} as const;

/**
 * 배분 시뮬레이터(GAS qa_distribution) Sheets → qradar 적재 테이블.
 * 소스 스프레드시트: docs.google.com/spreadsheets/d/1zVtfyduiNpZ0Ro3ZLiDRw4662IxXOufDESFrTHvyAxw
 */
export const distBq = {
  projectId: PROJECT,
  dataset: QRADAR_DATASET,
  location: QRADAR_LOCATION,
  tables: {
    config: qradarTable("dist_config"),
    aqt: qradarTable("dist_aqt"),
    teams: qradarTable("dist_teams"),
    evaluators: qradarTable("dist_evaluators"),
    assignHistory: qradarTable("dist_assign_history"),
    assignDetail: qradarTable("dist_assign_detail"),
    evalItemOptions: qradarTable("dist_eval_item_options"),
    monthLocks: qradarTable("eval_month_locks"),
    evalTargets: qradarTable("eval_targets"),
    evalTargetSnapshots: qradarTable("eval_target_snapshots"),
    hrEmployees: qradarTable("hr_employees"),
    teamColdMonthly: qradarTable("team_cold_monthly"),
    scheduleItems: qradarTable("qradar_eval_schedule_items"),
    schedulePersonal: qradarTable("qradar_eval_personal_events"),
  },
  sql: (table: string) => sqlFq(PROJECT, QRADAR_DATASET, table),
  fq: (table: string) => fq(PROJECT, QRADAR_DATASET, table),
} as const;

/** Sheets 탭명 → distBq.tables 키 */
export const DIST_SHEET_TO_TABLE = {
  config: "config",
  aqt: "aqt",
  teams: "teams",
  gps: "evaluators",
  history: "assignHistory",
  history_detail: "assignDetail",
  eval_items: "evalItemOptions",
  월확정: "monthLocks",
  평가대상자: "evalTargets",
  평가대상자_이력: "evalTargetSnapshots",
  /** 현행 시트 탭명 */
  재직자_RAW: "hrEmployees",
  /** GAS/문서 별칭 */
  "재직자 RAW": "hrEmployees",
  재직자_raw: "hrEmployees",
  "팀별 COLD Count": "teamColdMonthly",
} as const satisfies Record<string, keyof typeof distBq.tables>;

/** 마이그레이션·문서용: 앱이 적재하는 테이블 논리 키 → 실제 테이블명 */
export const QRADAR_WRITABLE_TABLES = {
  usageEvents: appBq.tables.usageEvents,
  llmPromptVersions: promptBq.tables.versions,
  llmPromptProdHistory: promptBq.tables.prodHistory,
  llmCriterionPrompts: promptBq.tables.criterionPrompts,
  llmPromptFieldConfig: promptBq.tables.fieldConfig,
  highRiskFlagRules: promptBq.tables.highRiskFlagRules,
  longCallThresholds: promptBq.tables.longCallThresholds,
  evaluationResults: growthBq.resultsTable,
  /** @deprecated */
  evaluationResultsPay: growthBq.resultsTable,
  /** @deprecated 동일 테이블 */
  qaEvalResults: growthBq.resultsTable,
  llmCallLogs: growthBq.llmCallLogs,
  sttCallLogs: growthBq.sttCallLogs,
  evalHumanReviews: growthBq.evalHumanReviews,
  evalSetCriteria: growthBq.evalSetCriteria,
  evalCriterionResults: growthBq.evalCriterionResults,
} as const;

/** 디버그/로그용 요약. */
export function bqRefsSummary(): string {
  return [
    `BQ_TARGET=${BQ_TARGET}`,
    `project=${PROJECT}`,
    `qradar=${QRADAR_DATASET} (${QRADAR_LOCATION})`,
    `shared=${SHARED_DATASET}`,
    `app=${appBq.tables.usageEvents}, …`,
    `prompt=${promptBq.tables.versions}`,
    `results=${growthBq.resultsTable} (unified call_eval+qa_eval)`,
    `cases=${CASES_DATASET_TABLE}`,
    `criteria=${CRITERIA_VIEW || "(hardcoded)"}`,
    `qaRef=${QA_REFERENCES_VIEW || "(none)"} (>=${QA_REFERENCES_MIN_YEAR_MONTH})`,
    `qmsCases=${QMS_CASES_DETAIL_VIEW || "(none)"}`,
    `dist=${distBq.tables.evalTargets},…`,
    `llmLogs=${growthBq.llmCallLogs}`,
  ].join(" | ");
}
