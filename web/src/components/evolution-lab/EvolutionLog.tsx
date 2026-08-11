'use client';

import { useWebSocket } from '@/lib/useWebSocket';

interface Props {
  taskId: string;
}

export function EvolutionLog({ taskId }: Props) {
  const { messages, connected } = useWebSocket(taskId ? `evolution/${taskId}` : undefined);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">📋 进化事件流</h2>
        <span className={`text-xs ${connected ? 'text-green-500' : 'text-gray-400'}`}>
          {connected ? '● 实时' : '○ 未连接'}
        </span>
      </div>
      <div className="max-h-48 space-y-1 overflow-y-auto font-mono text-xs">
        {messages.map((msg, i) => (
          <div key={i} className="rounded bg-gray-50 px-2 py-1">
            <span className="text-gray-400">[{msg.type}]</span>{' '}
            <span className="text-gray-700">{JSON.stringify(msg.data ?? '').slice(0, 160)}</span>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="py-6 text-center text-gray-400">等待事件…</p>
        )}
      </div>
    </div>
  );
}
