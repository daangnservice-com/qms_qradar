import { describe, it, expect } from "vitest";
import {
  qradarTable,
  bqOut,
  BQ_TARGET,
  isBqDev,
  appBq,
  growthBq,
  promptBq,
  distBq,
  DIST_SHEET_TO_TABLE,
  bqRefsSummary,
} from "./bqRefs";

describe("bqRefs — dataset split + qradar_ prefix", () => {
  it("qradarTable adds prefix and strips legacy _dev suffix", () => {
    expect(qradarTable("usage_events")).toBe("qradar_usage_events");
    expect(qradarTable("qradar_evaluation_results")).toBe("qradar_evaluation_results");
    expect(qradarTable("qa_eval_results_dev")).toBe("qradar_qa_eval_results");
    expect(qradarTable("qradar_evaluation_results_dev")).toBe("qradar_evaluation_results");
  });

  it("bqOut no longer appends _dev", () => {
    expect(bqOut("usage_events")).toBe("usage_events");
  });

  it("writable tables share the qradar dataset for current target", () => {
    const expectedDs = BQ_TARGET === "dev" ? "ds_qradar_dev" : "ds_qradar_prod";
    // QRADAR_DATASET env가 있으면 그게 이김 — 없으면 타겟 기본
    expect([expectedDs, process.env.QRADAR_DATASET].filter(Boolean)).toContain(appBq.dataset);
    expect(appBq.dataset).toBe(promptBq.dataset);
    expect(appBq.dataset).toBe(growthBq.dataset);
    expect(appBq.dataset).toBe(distBq.dataset);
    expect(appBq.tables.usageEvents).toBe("qradar_usage_events");
    expect(promptBq.tables.versions).toBe("qradar_llm_prompt_versions");
    expect(promptBq.tables.highRiskFlagRules).toBe("qradar_high_risk_flag_rules");
    expect(promptBq.tables.longCallThresholds).toBe("qradar_long_call_thresholds");
    expect(growthBq.qaEvalResults).toBe("qradar_evaluation_results");
    expect(growthBq.resultsTablePay).toBe("qradar_evaluation_results");
    expect(growthBq.llmCallLogs).toBe("qradar_llm_call_logs");
    expect(growthBq.evalReviewCompletions).toBe("qradar_eval_review_completions");
    expect(growthBq.resultsTable).toBe("qradar_evaluation_results");
    expect(distBq.tables.evalTargets).toBe("qradar_eval_targets");
    expect(DIST_SHEET_TO_TABLE["평가대상자"]).toBe("evalTargets");
    expect(DIST_SHEET_TO_TABLE.gps).toBe("evaluators");
    expect(DIST_SHEET_TO_TABLE["재직자_RAW"]).toBe("hrEmployees");
  });

  it("shared inputs stay on growth culture (not qradar target)", () => {
    expect(growthBq.sharedDataset).toMatch(/growth|culture|ds_/);
    expect(growthBq.casesDatasetTable).not.toMatch(/ds_qradar_/);
    expect(growthBq.criteriaView).not.toMatch(/ds_qradar_/);
    expect(growthBq.qmsCasesDetailView).toContain("vw_quality_evaluation_cases_detail_with_fallback");
    expect(growthBq.qaReferencesMinYearMonth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof isBqDev).toBe("boolean");
    expect(bqRefsSummary()).toContain("BQ_TARGET=");
    expect(bqRefsSummary()).toContain("qradar=");
    expect(bqRefsSummary()).toContain("qaRef=");
    expect(bqRefsSummary()).toContain("qmsCases=");
  });
});
