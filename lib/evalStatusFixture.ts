import type {
  EvalStatusResponse,
  QmsCaseRow,
  UnconfirmedCaseNode,
  UnconfirmedCurrentMonth,
  UnconfirmedSheetNode,
  UnconfirmedTargetNode,
  UnconfirmedTemplateNode,
  UnconfirmedTeamNode,
} from "@/lib/resultsStore";

/** 평가 현황 UI 레퍼런스용 샘플. API·BigQuery 없음. */

const MONTHS = ["2026-08", "2026-07", "2026-06"];

function caseNode(id: string, name: string, evaluated: boolean): UnconfirmedCaseNode {
  return {
    id,
    name,
    status: evaluated ? "evaluated" : "pending",
    statusLabel: evaluated ? "평가완료" : "대기",
  };
}

function targetNode(
  id: string,
  name: string,
  evaluated: boolean,
  cases: UnconfirmedCaseNode[],
): UnconfirmedTargetNode {
  return {
    id,
    name,
    status: evaluated ? "evaluated" : "pending",
    statusLabel: evaluated ? "평가완료" : "대기",
    targetCount: 1,
    openTargetCount: evaluated ? 0 : 1,
    caseCount: cases.length,
    openCaseCount: cases.filter((c) => c.status !== "evaluated").length,
    cases,
  };
}

function rollupSheets(sheets: UnconfirmedSheetNode[]) {
  const targetCount = sheets.reduce((n, s) => n + s.targetCount, 0);
  const openTargetCount = sheets.reduce((n, s) => n + s.openTargetCount, 0);
  const caseCount = sheets.reduce((n, s) => n + s.caseCount, 0);
  const openCaseCount = sheets.reduce((n, s) => n + s.openCaseCount, 0);
  const openSheetCount = sheets.filter((s) => s.status !== "confirmed").length;
  return {
    targetCount,
    openTargetCount,
    caseCount,
    openCaseCount,
    sheetCount: sheets.length,
    openSheetCount,
    status: openSheetCount > 0 ? "open" : "confirmed",
    statusLabel: openSheetCount > 0 ? "미확정" : "확정",
  };
}

function sheetNode(
  id: string,
  name: string,
  status: string,
  statusLabel: string,
  targets: UnconfirmedTargetNode[],
): UnconfirmedSheetNode {
  return {
    id,
    name,
    status,
    statusLabel,
    targets,
    targetCount: targets.length,
    openTargetCount: targets.filter((t) => t.status !== "evaluated").length,
    caseCount: targets.reduce((n, t) => n + t.caseCount, 0),
    openCaseCount: targets.reduce((n, t) => n + t.openCaseCount, 0),
  };
}

function templateNode(id: string, name: string, sheets: UnconfirmedSheetNode[]): UnconfirmedTemplateNode {
  return { id, name, sheets, ...rollupSheets(sheets) };
}

function teamNode(id: string, name: string, templates: UnconfirmedTemplateNode[]): UnconfirmedTeamNode {
  const rolled = rollupSheets(templates.flatMap((t) => t.sheets));
  return { id, name, templates, ...rolled };
}

function monthPayload(
  month: string,
  tree: UnconfirmedTeamNode[],
  byEvalStatus: UnconfirmedCurrentMonth["byEvalStatus"],
): UnconfirmedCurrentMonth {
  const sheets = tree.flatMap((t) => t.templates.flatMap((tpl) => tpl.sheets));
  return {
    month,
    evalCount: sheets.length,
    openEvalCount: sheets.filter((s) => s.status !== "confirmed").length,
    targetCount: tree.reduce((n, t) => n + t.targetCount, 0),
    openTargetCount: tree.reduce((n, t) => n + t.openTargetCount, 0),
    caseCount: tree.reduce((n, t) => n + t.caseCount, 0),
    openCaseCount: tree.reduce((n, t) => n + t.openCaseCount, 0),
    byEvalStatus,
    tree,
    truncated: false,
    source: "none",
  };
}

const august = monthPayload(
  "2026-08",
  [
    teamNode("team-ad", "광고팀", [
      templateNode("tpl-community", "커뮤니티 문의", [
        sheetNode("eval-801", "8월 품질평가", "gp_review", "GP 검토", [
          targetNode("tgt-8011", "김민수", false, [
            caseNode("81001", "중고거래 게시글 신고", false),
            caseNode("81002", "사기 의심 문의", false),
            caseNode("81003", "차단 해제 요청", true),
          ]),
          targetNode("tgt-8012", "이서연", true, [
            caseNode("81004", "채팅 매너 위반", true),
            caseNode("81005", "중복 게시글", true),
          ]),
        ]),
        sheetNode("eval-802", "8월 품질평가 2차", "confirmed", "확정", [
          targetNode("tgt-8021", "최하늘", true, [
            caseNode("81006", "거래 취소 분쟁", true),
            caseNode("81007", "환불 요청", true),
          ]),
        ]),
      ]),
      templateNode("tpl-phone", "전화 CS", [
        sheetNode("eval-803", "8월 전화", "leader_review", "리더 검토", [
          targetNode("tgt-8031", "정우진", false, [
            caseNode("81008", "계정 정지 문의", false),
            caseNode("81009", "본인인증 실패", false),
          ]),
        ]),
      ]),
    ]),
    teamNode("team-pay", "페이팀", [
      templateNode("tpl-chat", "채팅 문의", [
        sheetNode("eval-804", "8월 채팅", "confirmed", "확정", [
          targetNode("tgt-8041", "박지훈", true, [
            caseNode("81010", "결제 실패", true),
            caseNode("81011", "송금 지연", true),
          ]),
        ]),
      ]),
    ]),
  ],
  [
    { status: "gp_review", label: "GP 검토", count: 1 },
    { status: "leader_review", label: "리더 검토", count: 1 },
    { status: "confirmed", label: "확정", count: 2 },
  ],
);

const july = monthPayload(
  "2026-07",
  [
    teamNode("team-ad", "광고팀", [
      templateNode("tpl-community", "커뮤니티 문의", [
        sheetNode("eval-701", "7월 품질평가", "confirmed", "확정", [
          targetNode("tgt-7011", "김민수", true, [
            caseNode("71001", "허위매물 신고", true),
            caseNode("71002", "닉네임 변경", true),
          ]),
        ]),
      ]),
    ]),
    teamNode("team-pay", "페이팀", [
      templateNode("tpl-chat", "채팅 문의", [
        sheetNode("eval-702", "7월 채팅", "confirmed", "확정", [
          targetNode("tgt-7021", "박지훈", true, [
            caseNode("71003", "카드 등록 오류", true),
            caseNode("71004", "영수증 재발급", true),
          ]),
        ]),
      ]),
    ]),
  ],
  [{ status: "confirmed", label: "확정", count: 2 }],
);

const june = monthPayload("2026-06", [], []);

const BY_MONTH: Record<string, UnconfirmedCurrentMonth> = {
  "2026-08": august,
  "2026-07": july,
  "2026-06": june,
};

export function getEvalStatusFixture(month?: string): EvalStatusResponse {
  const ym = month && BY_MONTH[month] ? month : "2026-08";
  return { ...BY_MONTH[ym], months: MONTHS };
}

function mockCase(partial: Partial<QmsCaseRow> & Pick<QmsCaseRow, "caseId" | "caseKey" | "firstName">): QmsCaseRow {
  const teamLabel = partial.teamLabel || "광고팀";
  const memberLabel = partial.firstName;
  return {
    evaluationId: "801",
    evaluationTemplateId: "11",
    evaluationTargetId: "8011",
    templateName: "커뮤니티 문의",
    yearMonth: "2026-08",
    teamId: "ad",
    teamName: teamLabel,
    fallbackTeamName: teamLabel,
    targetAdminUserId: "u-1",
    employeeNumber: "12345",
    status: "pending",
    result: "hot",
    evaluationStatus: "gp_review",
    evaluatedCount: 1,
    coldCount: 0,
    caseContent: "",
    caseStatus: "pending",
    caseScores: "{}",
    caseResult: "pass",
    caseExtra: "{}",
    scoreDetail: "",
    memoDetail: "",
    evaluationExtra: JSON.stringify({ title: "8월 품질평가" }),
    extra: "{}",
    isCold: false,
    hasWrongScore: false,
    hasMemo: false,
    teamLabel,
    memberLabel,
    memberKey: memberLabel,
    templateKey: "커뮤니티 문의",
    templateLabel: "커뮤니티 문의",
    ...partial,
  };
}

const CASES: Record<string, QmsCaseRow> = {
  "81001": mockCase({
    caseId: "81001",
    caseKey: "81001",
    firstName: "김민수",
    caseStatus: "pending",
    result: "hot",
    caseContent: JSON.stringify(
      {
        inquiry: "중고거래 게시글이 사기 같아요. 상대가 선입금을 요구합니다.",
        channel: "채팅",
        url: "https://www.daangn.com/articles/example",
      },
      null,
      2,
    ),
    hasMemo: true,
    memoDetail: "고객이 보낸 대화 캡처를 기준으로 선입금 유도 여부를 확인하세요.",
  }),
  "81002": mockCase({
    caseId: "81002",
    caseKey: "81002",
    firstName: "김민수",
    caseStatus: "pending",
    result: "cold",
    isCold: true,
    hasWrongScore: true,
    scoreDetail: "공감 표현 누락 · 다음 안내 없이 종료",
    caseContent: "사기 의심 문의인데 상담원이 정책만 안내하고 대화를 끝냈어요.",
    caseScores: JSON.stringify({ empathy: 0, next_step: 0, accuracy: 1 }),
  }),
  "81004": mockCase({
    caseId: "81004",
    caseKey: "81004",
    firstName: "이서연",
    caseStatus: "evaluated",
    status: "evaluated",
    result: "hot",
    caseContent: "채팅에서 비속어를 사용한 상대를 신고하고 싶어요.",
  }),
  "81008": mockCase({
    caseId: "81008",
    caseKey: "81008",
    firstName: "정우진",
    templateName: "전화 CS",
    templateLabel: "전화 CS",
    templateKey: "전화 CS",
    evaluationStatus: "leader_review",
    caseStatus: "pending",
    caseContent: "계정 정지 사유를 전화로 확인하고 해제 가능 여부를 문의.",
    hasMemo: true,
    memoDetail: "본인확인 후 제재 이력을 같이 보세요.",
  }),
  "81010": mockCase({
    caseId: "81010",
    caseKey: "81010",
    firstName: "박지훈",
    teamLabel: "페이팀",
    teamName: "페이팀",
    templateName: "채팅 문의",
    status: "evaluated",
    caseStatus: "evaluated",
    evaluationStatus: "confirmed",
    result: "hot",
    caseContent: "결제 실패 안내 후 재시도 방법을 안내한 케이스.",
  }),
};

export function getEvalStatusFixtureCase(caseId: string): QmsCaseRow {
  const hit = CASES[caseId];
  if (hit) return hit;
  return mockCase({
    caseId,
    caseKey: caseId,
    firstName: "샘플 상담원",
    caseContent: "레퍼런스용 샘플 케이스입니다. 실제 상담 내용은 없어요.",
  });
}
