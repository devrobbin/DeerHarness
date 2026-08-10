import { useEffect, useRef, useState, useCallback } from 'react';

const GATEWAY_WS = (process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8080')
  .replace('http', 'ws');

export function useWebSocket(channel?: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const url = channel ? `${GATEWAY_WS}/ws/${channel}` : `${GATEWAY_WS}/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (channel) {
        ws.send(JSON.stringify({ type: 'subscribe', channel }));
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setMessages(prev => [...prev.slice(-99), data]);
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    return () => ws.close();
  }, [channel]);

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { messages, connected, send };
}
