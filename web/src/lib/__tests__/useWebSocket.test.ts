import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from '../useWebSocket';

// 模拟浏览器 WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  // 测试辅助
  open() { this.readyState = 1; this.onopen?.(); }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
}

describe('useWebSocket', () => {
  beforeEach(() => {
    (global as any).WebSocket = MockWebSocket;
    MockWebSocket.instances = [];
    localStorage.clear();
  });

  it('connects to ws URL and subscribes to channel', () => {
    localStorage.setItem('dh_api_key', 'k');
    const { result } = renderHook(() => useWebSocket('evolution/t1'));
    expect(MockWebSocket.instances.length).toBe(1);
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());
    // token 走 Sec-WebSocket-Protocol 子协议（不落 query string）
    expect(ws.url).not.toContain('token=');
    expect(ws.sent).toContain(JSON.stringify({ type: 'subscribe', channel: 'evolution/t1' }));
    expect(result.current.connected).toBe(true);
  });

  it('receives and appends parsed messages', () => {
    localStorage.setItem('dh_api_key', 'k');
    const { result } = renderHook(() => useWebSocket());
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());
    act(() => ws.emit({ type: 'trace', data: { id: 1 } }));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].type).toBe('trace');
  });
});
