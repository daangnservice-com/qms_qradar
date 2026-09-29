import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPromptSeed } from './promptDefaults';
import { DEFAULT_AUDIO_PIPELINE_CONFIG } from './promptTypes';

const mocks = vi.hoisted(() => ({ query: vi.fn(), list: vi.fn(), snapshot: vi.fn(), sync: vi.fn() }));
vi.mock('./servingDb', () => ({ servingRows: mocks.query }));
vi.mock('./criterionStore', () => ({ ensureCriterionTables: vi.fn(), seedDraftCriterionPromptsFromChecklist: vi.fn(), listCriterionPrompts: mocks.list, buildCriteriaSnapshot: mocks.snapshot, listFieldKeys: vi.fn().mockResolvedValue([]) }));
vi.mock('./evaluationDimensionStore', () => ({ syncEvalSetCriteria: mocks.sync }));
import { savePromptVersion, setProductionVersion, getProductionPrompt, validatePromptVersionChannels } from './promptStore';

const seed = defaultPromptSeed('feedback_eval');
const binding = { criterionId: 415, promptId: 'phone', enabled: true };
const row = { version_id: 'legacy', template_key: 'feedback_eval', status: 'production', criterion_bindings_json: JSON.stringify([binding]), criteria_json: '[{"id":415,"hint":"old"}]', response_schema_json: '{}', use_checklist: true };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([{ criterionId: 415, promptId: 'phone', exposureChannels: ['phone'] }]);
  mocks.query.mockImplementation(async (text: string) => text.includes('count(*)') ? [{ n: 1 }] : [row]);
});
describe('server channel enforcement', () => {
  it('rejects wrong-channel draft save before inserting or demoting any version', async () => {
    await expect(savePromptVersion({ ...seed, criterionBindings: [binding], audioPipelineConfig: DEFAULT_AUDIO_PIPELINE_CONFIG, createdBy: 'fixture', promote: true })).rejects.toThrow('노출된 프롬프트');
    expect(mocks.query.mock.calls.some(([text]) => /insert into|update /i.test(text))).toBe(false);
  });
  it('rejects wrong-channel publication before demoting production', async () => {
    await expect(setProductionVersion({ templateKey: 'feedback_eval', versionId: 'legacy', changedBy: 'fixture' })).rejects.toThrow('노출된 프롬프트');
    expect(mocks.query.mock.calls.some(([text]) => /insert into|update /i.test(text))).toBe(false);
  });
  it('rejects execution rather than silently using the hardcoded fallback', async () => {
    await expect(getProductionPrompt('feedback_eval', { ensure: false })).rejects.toThrow('노출된 프롬프트');
  });
  it('preserves only the frozen migrated binding without granting new selection rights', async () => {
    const v = { ...seed, versionId: 'legacy', status: 'production', criterionBindings: [binding], legacyChannelSnapshotJson: JSON.stringify({ templateKey: 'feedback_eval', bindings: [binding], criteria: [{ id: 415, hint: 'frozen' }] }) } as any;
    expect((await validatePromptVersionChannels(v))?.[0].hint).toBe('frozen');
    v.criterionBindings = [{ ...binding, promptId: 'other' }];
    await expect(validatePromptVersionChannels(v)).rejects.toThrow('호환 스냅샷');
  });
});
