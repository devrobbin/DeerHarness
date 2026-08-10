'use client';

import { useWebSocket } from '@/lib/useWebSocket';

interface Props {
  taskId: string;
}

export function LiveEvolutionTracker({ taskId }: Props) {
  const { messages, connected } = useWebSocket(taskId ? `evolution/${taskId}` : undefined);

  const latest = messages.length > 0 ? messages[messages.length - 1] : null;

  return (
    <div className="p-4 bg-gray-900 text-green-400 rounded-lg font-mono text-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-400">实时进化日志</span>
        <span className={`flex items-center gap-1 ${connected ? 'text-green-400' : 'text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          {connected ? '已连接' : '断开'}
        </span>
      </div>

      <div className="max-h-64 overflow-y-auto space-y-1">
        {messages.map((msg, i) => (
          <div key={i} className="text-xs">
            <span className="text-gray-500">[{new Date(msg.timestamp * 1000).toLocaleTimeString()}]</span>{' '}
            <span className="text-yellow-400">{msg.type}</span>{' '}
            <span>{JSON.stringify(msg.data).slice(0, 120)}</span>
          </div>
        ))}
        {messages.length === 0 && (
          <div className="text-gray-500">等待事件...</div>
        )}
      </div>

      {latest?.type === 'evolution_progress' && (
        <div className="mt-3 pt-2 border-t border-gray-700">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>进度</span>
            <span>{latest.data.current_round}/{latest.data.max_rounds}</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all"
              style={{ width: `${(latest.data.current_round / latest.data.max_rounds) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
