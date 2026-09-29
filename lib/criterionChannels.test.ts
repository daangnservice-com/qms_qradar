import { describe, it, expect } from 'vitest';
import { readExposureChannels, requireExposureChannels, validateChannelBindings } from './criterionChannels';
import type { CriterionPrompt } from './promptTypes';
import { validateChecklistCoverage } from './checklistCoverage';

const prompt = (id: string, channels?: CriterionPrompt['exposureChannels']): CriterionPrompt => ({ promptId: id, criterionId: 415, exposureChannels: channels, fields: { definition: id, custom: 'keep' }, versionLabel: id, category: '공감', label: '공감', updatedAt: '', updatedBy: 'fixture' });
describe('channel-scoped immutable detail selection', () => {
  it('only missing historical metadata maps to phone; empty or invalid selections fail', () => {
    expect(readExposureChannels(undefined)).toEqual(['phone']);
    for (const raw of [[], '', ['invalid'], null]) expect(() => requireExposureChannels(raw)).toThrow();
    expect(() => readExposureChannels('[]')).toThrow();
    expect(requireExposureChannels(['chatcs', 'feedback', 'feedback'])).toEqual(['feedback', 'chatcs']);
  });
  it('supports independently selected versions and multi-channel shared versions', () => {
    const rows = [prompt('phone'), prompt('text-v1', ['feedback', 'chatcs']), prompt('feedback-v2', ['feedback'])];
    for (const [channel, id] of [['phone', 'phone'], ['feedback', 'text-v1'], ['chatcs', 'text-v1'], ['feedback', 'feedback-v2']] as const) {
      expect(() => validateChannelBindings([{ criterionId: 415, promptId: id, enabled: true }], rows, channel)).not.toThrow();
    }
    expect(() => validateChannelBindings([{ criterionId: 415, promptId: 'feedback-v2', enabled: true }], rows, 'chatcs')).toThrow();
    expect(rows[1].exposureChannels).toEqual(['feedback', 'chatcs']);
  });
  it('never falls back to latest, another channel, or another criterion', () => {
    const rows = [prompt('latest', ['feedback'])];
    for (const id of ['', 'missing']) expect(() => validateChannelBindings([{ criterionId: 415, promptId: id, enabled: true }], rows, 'feedback')).toThrow();
    expect(() => validateChannelBindings([{ criterionId: 545, promptId: 'latest', enabled: true }], rows, 'feedback')).toThrow();
    expect(() => validateChannelBindings([{ criterionId: 415, promptId: 'latest', enabled: true }], rows, 'phone')).toThrow();
    expect(() => validateChannelBindings([{ criterionId: 413, promptId: '', enabled: false }], rows, 'feedback')).not.toThrow();
  });
  it('rejects missing, duplicate and inactive output instead of inventing normal results', () => {
    expect(() => validateChecklistCoverage([{ id: 415 }], [415])).not.toThrow();
    for (const rows of [[], [{ id: 413 }], [{ id: 415 }, { id: 415 }], [{ id: 415 }, { id: 547 }]]) expect(() => validateChecklistCoverage(rows, [415])).toThrow();
    expect(() => validateChecklistCoverage([], [])).not.toThrow();
  });
});
