// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import EvalAiItemsWorkbench from './EvalAiItemsWorkbench';

const fixture = vi.hoisted(() => ({
  source: [{ id: 415, name: '공감', parentName: 'CS', type: '', parentId: null, extra: '' }],
  prompts: [
    { promptId: 'phone-v1', criterionId: 415, versionLabel: 'phone-v1', category: 'CS', label: '공감', fields: { definition: '전화 정의', custom: '동적 내용', hidden: '보존' }, exposureChannels: ['phone'], updatedAt: '2026-09-01', updatedBy: 'fixture' },
    { promptId: 'text-v1', criterionId: 415, versionLabel: 'text-v1', category: 'CS', label: '공감', fields: { definition: '문의 정의', custom: '문의 동적 내용', hidden: '보존' }, exposureChannels: ['feedback', 'chatcs'], updatedAt: '2026-09-02', updatedBy: 'fixture' },
  ],
  fieldKeys: [{ key: 'definition', label: '정의', enabled: true, sortOrder: 1 }, { key: 'custom', label: '추가 상세', enabled: true, sortOrder: 2 }, { key: 'hidden', label: '숨긴 필드', enabled: false, sortOrder: 3 }],
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('@/lib/useCachedFetch', () => ({ useCachedFetch: () => ({ data: fixture, refresh, loading: false, error: null }) }));
vi.mock('@/lib/clientCache', () => ({ cacheInvalidate: vi.fn() }));

beforeEach(() => { cleanup(); vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ prompt: { promptId: 'saved', versionLabel: 'saved' } }) })); });
describe('detail exposure UI', () => {
  it('filters versions by channel and displays the selected detail', async () => {
    render(<EvalAiItemsWorkbench />);
    fireEvent.change(screen.getByLabelText('노출 채널 필터'), { target: { value: 'phone' } });
    await waitFor(() => expect(screen.getByLabelText('정의')).toHaveValue('전화 정의'));
    expect(screen.queryByRole('button', { name: /text-v1/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('노출 채널 필터'), { target: { value: 'feedback' } });
    await waitFor(() => expect(screen.getByLabelText('정의')).toHaveValue('문의 정의'));
    expect(screen.queryByRole('button', { name: /phone-v1/ })).toBeNull();
  });
  it('requires a nonempty selection and sends multiple channels without losing dynamic fields', async () => {
    render(<EvalAiItemsWorkbench />);
    await waitFor(() => expect(screen.getByLabelText('정의')).toHaveValue('문의 정의'));
    fireEvent.click(screen.getByRole('checkbox', { name: '인앱 문의' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '채팅' }));
    fireEvent.click(screen.getByRole('button', { name: '새 버전 저장' }));
    expect(await screen.findByText('노출 채널을 최소 하나 선택하세요')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: '콜(전화)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '인앱 문의' }));
    fireEvent.click(screen.getByRole('button', { name: '새 버전 저장' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.exposureChannels).toEqual(['phone', 'feedback']);
    expect(body.fields).toEqual({ definition: '문의 정의', custom: '문의 동적 내용', hidden: '보존' });
  });
});
