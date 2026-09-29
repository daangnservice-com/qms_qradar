// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import EvalSheetsWorkbench from './EvalSheetsWorkbench';
const data = vi.hoisted(() => ({
  source: [{ id: 415, name: '공감', parentName: 'CS' }],
  prompts: [
    { promptId: 'phone-v1', criterionId: 415, versionLabel: 'phone-v1', exposureChannels: ['phone'], fields: { definition: '전화 상세' }, updatedAt: '2026-09-01' },
    { promptId: 'feedback-v1', criterionId: 415, versionLabel: 'feedback-v1', exposureChannels: ['feedback'], fields: { definition: '문의 상세 1' }, updatedAt: '2026-09-02' },
    { promptId: 'feedback-v2', criterionId: 415, versionLabel: 'feedback-v2', exposureChannels: ['feedback', 'chatcs'], fields: { definition: '문의 상세 2' }, updatedAt: '2026-09-03' },
  ],
}));
const empty = vi.hoisted(() => ({ rows: [], versions: [] }));
vi.mock('@/lib/useCachedFetch', () => ({ useCachedFetch: ({ key }: { key: string }) => ({ data: key === 'criterionPrompts' ? data : empty, loading: false, refresh: vi.fn() }) }));
vi.mock('@/lib/clientCache', () => ({ cacheInvalidate: vi.fn() }));
describe('evaluation sheet explicit channel selection', () => {
  it('lists eligible versions with contents and never auto-selects the newest', () => {
    render(<EvalSheetsWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /인앱.*문의/ }));
    fireEvent.click(screen.getByRole('button', { name: '새 평가표' }));
    const select = screen.getByTitle('프롬프트 버전');
    expect(select).toHaveValue('');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options.join(' ')).toContain('문의 상세 1');
    expect(options.join(' ')).toContain('문의 상세 2');
    expect(options.join(' ')).not.toContain('phone-v1');
    fireEvent.change(select, { target: { value: 'feedback-v1' } });
    expect(select).toHaveValue('feedback-v1');
    expect(screen.getByText('definition: 문의 상세 1')).toBeTruthy();
  });
});
