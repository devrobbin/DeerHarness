export const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8080';

const KEY_STORAGE = 'dh_api_key';

export function getApiKey(): string {
  return typeof localStorage !== 'undefined' ? (localStorage.getItem(KEY_STORAGE) ?? '') : '';
}

export function setApiKey(key: string) {
  localStorage.setItem(KEY_STORAGE, key);
}

function authHeaders(): Record<string, string> {
  const key = getApiKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function handle(res: Response, path: string): Promise<any> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch { /* 非 JSON 响应 */ }
    throw new Error(`${path}: ${detail}`);
  }
  return res.json();
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${GATEWAY}${path}`, { headers: authHeaders() });
  return handle(res, path);
}

export async function apiPost<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${GATEWAY}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle(res, path);
}

export async function apiDelete<T = any>(path: string): Promise<T> {
  const res = await fetch(`${GATEWAY}${path}`, { method: 'DELETE', headers: authHeaders() });
  return handle(res, path);
}

/** 带鉴权的流式请求（SSE 用） */
export async function apiStream(path: string, body: unknown): Promise<Response> {
  return fetch(`${GATEWAY}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
}
