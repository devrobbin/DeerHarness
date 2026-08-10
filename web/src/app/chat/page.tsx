'use client';

import { useState } from 'react';
import { useWebSocket } from '@/lib/useWebSocket';

export default function ChatPage() {
  const { messages, connected, send } = useWebSocket();
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;
    send({ type: 'message', content: input });
    setInput('');
  };

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">💬 Chat</h1>
        <span className={`flex items-center gap-1 text-sm ${connected ? 'text-green-500' : 'text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
          {connected ? '已连接 Gateway' : '未连接'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 rounded-lg border border-gray-200 bg-white p-4">
        {messages.length === 0 && <p className="text-center text-gray-400">等待事件…</p>}
        {messages.map((msg, i) => (
          <div key={i} className="rounded bg-gray-50 px-3 py-2 text-sm font-mono">
            <span className="text-gray-400">[{msg.type}]</span>{' '}
            <span>{JSON.stringify(msg.data ?? msg.content ?? '').slice(0, 200)}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="发送消息（经 WebSocket 推送）"
          className="flex-1 rounded border border-gray-300 p-2 text-sm"
        />
        <button onClick={handleSend} className="rounded bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600">
          发送
        </button>
      </div>
    </div>
  );
}
