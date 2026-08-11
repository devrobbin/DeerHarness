'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

interface Trace {
  trace_id: string;
  task_id: string;
  status: string;
  score?: number | null;
  received_at?: number;
}

export function AgentTraceViewer() {
  const [agentId, setAgentId] = useState('');
  const [traces, setTraces] = useState<Trace[]>([]);

  useEffect(() => {
    if (!agentId) {
      setTraces([]);
      return;
    }
    apiGet<{ traces: Trace[] }>(`/api/traces?agent_id=${encodeURIComponent(agentId)}&limit=20`)
      .then(d => setTraces(d.traces))
      .catch(() => setTraces([]));
  }, [agentId]);

  return (
    <div className="h-full rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 font-semibold">🔍 Trace 查看器</h2>
      <input
        placeholder="输入 Agent ID 查看执行轨迹"
        value={agentId}
        onChange={e => setAgentId(e.target.value)}
        className="mb-3 w-full p-2 border rounded text-sm"
      />
      <div className="space-y-2">
        {traces.map(t => (
          <div key={t.trace_id} className="flex items-center justify-between rounded border border-gray-100 p-2 text-sm">
            <span className="font-mono text-xs">{t.trace_id.slice(0, 8)}</span>
            <span className="text-gray-500">{t.task_id}</span>
            <span
              className={`rounded px-2 py-0.5 text-xs ${
                t.status === 'success'
                  ? 'bg-green-100 text-green-700'
                  : t.status === 'failed'
                    ? 'bg-red-100 text-red-600'
                    : 'bg-gray-100 text-gray-500'
              }`}
            >
              {t.status}
            </span>
            <span className="text-xs text-gray-500">得分：{t.score ?? '-'}</span>
          </div>
        ))}
        {agentId && traces.length === 0 && (
          <p className="text-center text-sm text-gray-400">该 Agent 暂无 Trace</p>
        )}
      </div>
    </div>
  );
}
