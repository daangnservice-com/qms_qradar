import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPromptSeed } from './promptDefaults';
import { deriveEvalLabel } from './resultParse';
const mocks = vi.hoisted(() => ({ run: vi.fn(), validate: vi.fn().mockResolvedValue(null) }));
vi.mock('./gemini', () => ({ runGeminiTextEvaluation: mocks.run }));
vi.mock('./promptStore', () => ({ getProductionPrompt: vi.fn(), validatePromptVersionChannels: mocks.validate }));
vi.mock('./highRiskFlagStore', () => ({ listHighRiskFlagRules: async () => [] }));
import { evaluateText } from './textEvaluation';
const config = () => ({ version: { ...defaultPromptSeed('feedback_eval'), useChecklist: true, criterionBindings: [{ criterionId: 415, promptId: 'feedback', enabled: true }] }, criteria: [{ id: 415, fields: { definition: 'fixture' } }], responseSchema: {} }) as any;
const turns = [{ turnId: '1', speaker: 'customer' as const, speakerLabel: '고객', text: '합성 문의' }];
const scoring = (csChecklist: any[]) => ({ csChecklist, scores: { attitude: { score: 5, comment: '좋음' } }, metrics: {}, overallSummary: '좋은 상담', silenceComments: [], error: null });
beforeEach(() => { vi.clearAllMocks(); mocks.validate.mockResolvedValue(null); });
describe('text execution coverage', () => {
  it('rejects extra inactive results and missing results before saving', async () => {
    for (const list of [[], [{ id: 415, violated: false, reason: '', evidence: [] }, { id: 547, violated: false, reason: '', evidence: [] }]]) {
      mocks.run.mockResolvedValue(scoring(list));
      await expect(evaluateText(turns, { channel: 'feedback', sourceSystem: 'fixture', sourceId: '1', promptConfig: config() })).rejects.toThrow('활성 평가항목');
    }
  });
  it('keeps good overall scores independent from review-needed detection', async () => {
    mocks.run.mockResolvedValue(scoring([{ id: 415, violated: true, reason: '원문 후보', evidence: [] }]));
    const result = await evaluateText(turns, { channel: 'feedback', sourceSystem: 'fixture', sourceId: '1', promptConfig: config() });
    expect(result.evaluation.scores.attitude.score).toBe(5);
    expect(deriveEvalLabel(result.evaluation)).toBe('review_needed');
    expect(result.evaluation.csChecklist!.map((c) => c.id)).toEqual([415]);
  });
  it('blocks a different channel and invalid bindings before any model call', async () => {
    await expect(evaluateText(turns, { channel: 'chatcs', sourceSystem: 'fixture', sourceId: '1', promptConfig: config() })).rejects.toThrow('채널');
    mocks.validate.mockRejectedValueOnce(new Error('잘못된 채널 바인딩'));
    await expect(evaluateText(turns, { channel: 'feedback', sourceSystem: 'fixture', sourceId: '1', promptConfig: config() })).rejects.toThrow('바인딩');
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
