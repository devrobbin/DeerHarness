'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

export function AgentCostPanel() {
  const [agentId, setAgentId] = useState('');
  const [data, setData] = useState<{ agent_id: string; traces: number; cost: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!agentId) {
      setData(null);
      setError('');
      return;
    }
    apiGet<{ agent_id: string; traces: number; cost: number }>(`/api/cost/agents/${encodeURIComponent(agentId)}`)
      .then(d => { setData(d); setError(''); })
      .catch(e => { setData(null); setError(e instanceof Error ? e.message : String(e)); });
  }, [agentId]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 font-semibold">💰 成本面板</h2>
      <input
        placeholder="输入 Agent ID 查看成本"
        value={agentId}
        onChange={e => setAgentId(e.target.value)}
        className="mb-3 w-full p-2 border rounded text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
      />
      {data && (
        <div className="rounded bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
          <p className="text-gray-600">Agent：<span className="font-medium">{data.agent_id}</span></p>
          <p className="text-gray-600">执行次数：<span className="font-medium">{data.traces}</span></p>
          <p className="text-2xl font-bold text-amber-600 mt-1">${data.cost}</p>
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
