'use client';

import React, { useEffect, useState } from 'react';
import { apiDelete, apiGet } from '@/lib/api';

interface Agent {
  id?: string;
  agent_id?: string;
  name: string;
  description?: string;
  model?: string | null;
  version?: string;
}

export function AgentList() {
  const [agents, setAgents] = useState<Agent[]>([]);

  const fetchAgents = async () => {
    try {
      const data = await apiGet<{ agents?: Agent[] }>('/api/agents');
      // 兼容两种返回形态：{agents: []} 或纯数组
      setAgents(data.agents ?? (Array.isArray(data) ? data : []));
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchAgents(); }, []);

  const handleDelete = async (id: string) => {
    await apiDelete(`/api/agents/${id}`);
    fetchAgents();
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">🤖 Agent 列表</h2>
        <button onClick={fetchAgents} className="text-xs text-blue-500 hover:text-blue-700">刷新</button>
      </div>
      <div className="space-y-2">
        {agents.map(a => (
          <div key={a.id ?? a.agent_id ?? a.name} className="flex items-center justify-between rounded border border-gray-100 p-2 text-sm">
            <div>
              <span className="font-medium">{a.name}</span>
              <span className="ml-2 text-xs text-gray-400">{a.model ?? ''}</span>
              <p className="text-xs text-gray-500">{a.description}</p>
            </div>
            <button
              onClick={() => handleDelete(a.id ?? a.agent_id ?? '')}
              className="text-red-500 text-sm hover:text-red-700"
            >
              删除
            </button>
          </div>
        ))}
        {agents.length === 0 && <p className="text-center text-sm text-gray-400">暂无 Agent</p>}
      </div>
    </div>
  );
}
