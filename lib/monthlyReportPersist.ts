import { createJsonFileStore } from "./jsonFileStore";

export function monthlyReportDraftKey(month: string, team: string): string {
  const ym = (month || "").trim();
  const t = (team || "").trim();
  return `${ym}|${t && t !== "__all__" ? t : "__all__"}`;
}

type SavedDraft = {
  text: string;
  savedAt: string;
  savedBy: string;
};

type State = {
  notes: Record<string, string>;
  reports: Record<string, SavedDraft>;
};

const empty = (): State => ({ notes: {}, reports: {} });

const store = createJsonFileStore<State>({
  name: "monthly-report",
  empty,
});

function asState(parsed: Partial<State>): State {
  return {
    notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
    reports: parsed.reports && typeof parsed.reports === "object" ? parsed.reports : {},
  };
}

export async function getMonthlyReportNotes(month: string): Promise<string> {
  const ym = month.trim();
  if (!ym) return "";
  return store.withLock(async () => asState(await store.load()).notes[ym] ?? "");
}

export async function setMonthlyReportNotes(month: string, specialNotes: string): Promise<void> {
  const ym = month.trim();
  if (!ym) return;
  await store.withLock(async () => {
    const state = asState(await store.load());
    state.notes[ym] = specialNotes;
    await store.save(state);
  });
}

export async function getSavedMonthlyReportDraft(
  month: string,
  team: string,
): Promise<SavedDraft | null> {
  const key = monthlyReportDraftKey(month, team);
  if (!month.trim()) return null;
  return store.withLock(async () => asState(await store.load()).reports[key] ?? null);
}

export async function saveMonthlyReportDraft(input: {
  month: string;
  team: string;
  text: string;
  specialNotes?: string;
  savedBy: string;
}): Promise<SavedDraft> {
  const key = monthlyReportDraftKey(input.month, input.team);
  const saved: SavedDraft = {
    text: input.text,
    savedAt: new Date().toISOString(),
    savedBy: input.savedBy,
  };
  await store.withLock(async () => {
    const state = asState(await store.load());
    state.reports[key] = saved;
    if (input.specialNotes != null && input.month.trim()) {
      state.notes[input.month.trim()] = input.specialNotes;
    }
    await store.save(state);
  });
  return saved;
}

export async function deleteSavedMonthlyReportDraft(month: string, team: string): Promise<void> {
  const key = monthlyReportDraftKey(month, team);
  await store.withLock(async () => {
    const state = asState(await store.load());
    delete state.reports[key];
    await store.save(state);
  });
}

export function extractPrevActionText(savedText: string | null | undefined): string {
  if (!savedText) return "";
  const m = savedText.match(/### 이번 달\n\n([\s\S]*?)(?=\n## |\n$|$)/);
  return m ? m[1].trim() : "";
}
