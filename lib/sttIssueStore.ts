import { randomUUID } from "node:crypto";
import { qradarTable } from "./bqRefs";
import { insertDistRows } from "./distDb";
import { servingRows } from "./servingDb";
import { parseSttSource, type SttSource, type TranscriptSegment } from "./types";
import type { LocalSttSegmentDetail } from "./localSttQuality";
import {
  formatSttIssueTranscript,
  isSttIssueTypeId,
  type SttIssueReport,
  type SttIssueTypeId,
} from "./sttIssueTypes";

// STT 이슈 신고. 원천은 서빙 Postgres(테이블 이름은 BQ 와 같다), BQ 는 야간 덤프 사본.
const TABLE = qradarTable("stt_issue_reports");

function tsValue(v: unknown): string {
  if (v && typeof v === "object" && "value" in (v as object)) {
    return String((v as { value: string }).value);
  }
  return String(v ?? "");
}

function parseTranscript(raw: unknown): TranscriptSegment[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const o = item as Record<string, unknown>;
        const text = String(o.text ?? "").trim();
        if (!text) return null;
        return {
          atSec: Number(o.atSec ?? 0) || 0,
          speaker: String(o.speaker ?? ""),
          text,
        } satisfies TranscriptSegment;
      })
      .filter((s): s is TranscriptSegment => s != null);
  } catch {
    return [];
  }
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseSegmentDetails(raw: unknown): LocalSttSegmentDetail[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const o = item as Record<string, unknown>;
      const text = String(o.text ?? "").trim();
      if (!text) return [];
      const atSec = Number(o.atSec ?? 0) || 0;
      return [
        {
          atSec,
          endSec: Number(o.endSec ?? atSec) || atSec,
          speaker: String(o.speaker ?? ""),
          text,
          avgLogprob: o.avgLogprob == null ? null : Number(o.avgLogprob),
          compressionRatio: o.compressionRatio == null ? null : Number(o.compressionRatio),
        },
      ];
    });
  } catch {
    return [];
  }
}

function rowToReport(r: Record<string, unknown>): SttIssueReport | null {
  const reportId = String(r.report_id ?? "").trim();
  const conversationId = String(r.conversation_id ?? "").trim();
  const issueType = String(r.issue_type ?? "").trim();
  if (!reportId || !conversationId || !isSttIssueTypeId(issueType)) return null;
  const transcript = parseTranscript(r.transcript_json);
  return {
    reportId,
    conversationId,
    issueType,
    sttSource: parseSttSource(r.stt_source),
    comment: String(r.comment ?? ""),
    transcript,
    transcriptText: String(r.transcript_text ?? "") || formatSttIssueTranscript(transcript),
    reportedBy: String(r.reported_by ?? ""),
    reportedAt: tsValue(r.reported_at),
    agentName: r.agent_name != null ? String(r.agent_name) : null,
    callDate: r.call_date != null ? String(r.call_date) : null,
    org: r.org != null ? String(r.org) : null,
    remoteJobId: r.remote_job_id != null ? String(r.remote_job_id) : null,
    sttOptions: parseJsonObject(r.stt_options_json),
    segments: parseSegmentDetails(r.segment_detail_json),
  };
}

const REPORT_COLUMNS = `
  report_id, conversation_id, issue_type, stt_source, comment,
  transcript_json, transcript_text, reported_by, reported_at,
  agent_name, call_date, org, remote_job_id, stt_options_json, segment_detail_json
`;

async function findSttIssueReport(
  conversationId: string,
  issueType: SttIssueTypeId,
): Promise<SttIssueReport | null> {
  const rows = await servingRows(
    `
      select ${REPORT_COLUMNS}
      from ${TABLE}
      where conversation_id = @conversation_id and issue_type = @issue_type
      order by reported_at desc
      limit 1
    `,
    { conversation_id: conversationId, issue_type: issueType },
  );
  const first = rows[0];
  return first ? rowToReport(first) : null;
}

export async function appendSttIssueReport(input: {
  conversationId: string;
  issueType: SttIssueTypeId;
  sttSource: SttSource | null;
  comment?: string;
  transcript: TranscriptSegment[];
  reportedBy: string;
  agentName?: string | null;
  callDate?: string | null;
  org?: string | null;
  remoteJobId?: string | null;
  sttOptions?: Record<string, unknown> | null;
  segments?: LocalSttSegmentDetail[];
}): Promise<{ report: SttIssueReport; duplicate: boolean }> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) throw new Error("conversationId 필요");
  const existing = await findSttIssueReport(conversationId, input.issueType).catch(() => null);
  if (existing) return { report: existing, duplicate: true };
  const reportedAt = new Date().toISOString();
  const transcript = Array.isArray(input.transcript) ? input.transcript : [];
  const row: SttIssueReport = {
    reportId: randomUUID(),
    conversationId,
    issueType: input.issueType,
    sttSource: input.sttSource,
    comment: (input.comment ?? "").trim(),
    transcript,
    transcriptText: formatSttIssueTranscript(transcript),
    reportedBy: input.reportedBy.trim(),
    reportedAt,
    agentName: input.agentName?.trim() || null,
    callDate: input.callDate?.trim() || null,
    org: input.org?.trim() || null,
    remoteJobId: input.remoteJobId?.trim() || null,
    sttOptions: input.sttOptions ?? null,
    segments: input.segments ?? [],
  };
  await insertDistRows(TABLE, [
    {
        report_id: row.reportId,
        conversation_id: row.conversationId,
        issue_type: row.issueType,
        stt_source: row.sttSource,
        comment: row.comment || null,
        transcript_json: JSON.stringify(row.transcript),
        transcript_text: row.transcriptText || null,
        reported_by: row.reportedBy || null,
        reported_at: row.reportedAt,
        agent_name: row.agentName,
        call_date: row.callDate,
        org: row.org,
        remote_job_id: row.remoteJobId,
        stt_options_json: row.sttOptions ? JSON.stringify(row.sttOptions) : null,
        segment_detail_json: JSON.stringify(row.segments),
    },
  ]);
  return { report: row, duplicate: false };
}

export async function listSttIssueReports(opts?: {
  issueType?: SttIssueTypeId | null;
  limit?: number;
}): Promise<SttIssueReport[]> {
  const lim = Math.min(Math.max(1, Math.floor(opts?.limit ?? 200)), 500);
  const issueType = opts?.issueType && isSttIssueTypeId(opts.issueType) ? opts.issueType : null;
  try {
    const rows = await servingRows(
      `
        select ${REPORT_COLUMNS}
        from ${TABLE}
        ${issueType ? "where issue_type = @issue_type" : ""}
        order by reported_at desc
        limit @lim
      `,
      issueType ? { issue_type: issueType, lim } : { lim },
    );
    return rows.map(rowToReport).filter((r): r is SttIssueReport => r != null);
  } catch (e) {
    console.warn("[sttIssueStore] list:", e instanceof Error ? e.message : e);
    return [];
  }
}
