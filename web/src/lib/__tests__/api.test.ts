import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiGet, apiPost, setApiKey } from '../api';

describe('api client', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('injects Bearer token from localStorage', async () => {
    setApiKey('test-key');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    await apiGet('/api/health');
    const [url, opts] = (global.fetch as any).mock.calls[0];
    expect(url).toContain('/api/health');
    expect(opts.headers.Authorization).toBe('Bearer test-key');
  });

  it('throws with FastAPI detail on error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ detail: '需要管理员权限' }),
    });
    await expect(apiGet('/api/settings/safety')).rejects.toThrow('需要管理员权限');
  });

  it('post sends JSON body', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 1 }) });
    await apiPost('/api/evolution/start', { target_type: 'agent' });
    const [, opts] = (global.fetch as any).mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ target_type: 'agent' });
    expect(opts.headers['Content-Type']).toContain('application/json');
  });
});
