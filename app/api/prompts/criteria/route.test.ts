import { beforeEach, describe, expect, it, vi } from 'vitest';
const save = vi.hoisted(() => vi.fn());
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { email: 'fixture@example.invalid' } }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/sessionAccessServer', () => ({ ensureSessionCanAccessQualityEval: async () => true }));
vi.mock('@/lib/serverCache', () => ({ cached: (_key: string, _ttl: number, fn: () => unknown) => fn(), cacheInvalidate: vi.fn(), SERVER_CACHE_TTL: {} }));
vi.mock('@/lib/criterionStore', () => ({ listSourceCriteria: async () => [], listCriterionPrompts: async () => [{ promptId: 'phone' }, { promptId: 'text', exposureChannels: ['feedback', 'chatcs'] }], listFieldKeys: async () => [], saveCriterionPrompt: save, saveFieldKeys: vi.fn() }));
import { GET, POST } from './route';
beforeEach(() => { vi.clearAllMocks(); save.mockImplementation(async (input) => ({ ...input, promptId: 'new-version' })); });
describe('channel metadata API', () => {
  it('rejects missing, empty and invalid channel selections', async () => {
    for (const exposureChannels of [undefined, [], ['other']]) {
      const response = await POST(new Request('http://localhost/api/prompts/criteria', { method: 'POST', body: JSON.stringify({ criterionId: 415, exposureChannels }) }));
      expect(response!.status).toBe(400);
    }
    expect(save).not.toHaveBeenCalled();
  });
  it('passes multi-channel metadata and custom fields into append-only saving', async () => {
    const response = await POST(new Request('http://localhost/api/prompts/criteria', { method: 'POST', body: JSON.stringify({ criterionId: 415, exposureChannels: ['feedback', 'chatcs'], fields: { custom: 'kept' } }) }));
    expect(response!.status).toBe(200);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ exposureChannels: ['feedback', 'chatcs'], fields: { custom: 'kept' } }));
  });
  it('filters exposure server-side without treating missing metadata as every channel', async () => {
    const response = await GET(new Request('http://localhost/api/prompts/criteria?channel=feedback'));
    expect((await response!.json()).prompts.map((p: { promptId: string }) => p.promptId)).toEqual(['text']);
    expect((await GET(new Request('http://localhost/api/prompts/criteria?channel=other')))!.status).toBe(400);
  });
});
