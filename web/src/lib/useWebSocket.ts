import { useEffect, useRef, useState, useCallback } from 'react';
import { getApiKey } from './api';

const GATEWAY_WS = (process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8080')
  .replace('http', 'ws');

/**
 * WebSocket 客户端：token 鉴权 + 坏帧防护 + 指数退避自动重连（评审 D/P0-2）。
 */
export function useWebSocket(channel?: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const token = getApiKey();
      const url = `${GATEWAY_WS}/ws${channel ? `/${channel}` : ''}?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setConnected(true);
        if (channel) {
          ws.send(JSON.stringify({ type: 'subscribe', channel }));
        }
      };

      ws.onmessage = (event) => {
        let data: any;
        try {
          data = JSON.parse(event.data); // 坏帧防护：解析失败丢弃
        } catch {
          return;
        }
        setMessages(prev => [...prev.slice(-99), data]);
      };

      ws.onclose = () => {
        setConnected(false);
        if (disposed) return;
        // 指数退避重连：3s → 6s → 12s … 上限 30s
        const delay = Math.min(3000 * 2 ** retryRef.current, 30000);
        retryRef.current += 1;
        timerRef.current = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        ws.close();
      };
    };

    connect();
    return () => {
      disposed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [channel]);

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { messages, connected, send };
}
