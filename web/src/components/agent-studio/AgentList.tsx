'use client';

import React, { useEffect, useState } from 'react';
import { apiDelete, apiGet } from '@/lib/api';
import { AgentSettings } from '@/components/agent-studio/AgentSettings';

interface Agent {
  id?: string;
  agent_id?: string;
  agentId?: string;
  name: string;
  description?: string;
  model?: string | null;
  version?: string;
  project_id?: string;
}

export function AgentList() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [editing, setEditing] = useState<Agent | null>(null);

  const fetchAgents = async () => {
    try {
      const data = await apiGet<{ agents?: Agent[] }>('/api/agents');
      // 兼容两种返回形态：{agents: []} 或纯数组
      setAgents(data.agents ?? (Array.isArray(data) ? data : []));
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchAgents(); }, []);

  const handleDelete = async (agent: Agent) => {
    const id = agent.agentId ?? agent.id ?? agent.agent_id ?? '';
    const projectId = agent.project_id ?? 'default_project';
    if (!id) return;
    if (!window.confirm(`删除 Agent「${agent.name}」？`)) return;
    try {
      await apiDelete(`/api/agents/${encodeURIComponent(id)}?project_id=${encodeURIComponent(projectId)}`);
      fetchAgents();
    } catch (err) {
      alert(`删除失败：${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <div className="h-full rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">🤖 Agent 列表</h2>
        <button onClick={fetchAgents} className="text-xs text-blue-500 hover:text-blue-700">刷新</button>
      </div>
      <div className="space-y-2">
        {agents.map(a => (
          <div key={a.id ?? a.agent_id ?? a.name} className="flex items-center justify-between rounded border border-gray-100 p-2 text-sm">
            <div className="min-w-0">
              <span className="font-medium">{a.name}</span>
              <span className="ml-2 text-xs text-gray-400">{a.model ?? ''}</span>
              <p className="truncate text-xs text-gray-500">{a.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setEditing(a)}
                className="text-blue-500 text-sm hover:text-blue-700"
                title="编辑定义 / 人设 / 运行参数"
              >
                编辑
              </button>
              <button
                onClick={() => handleDelete(a)}
                className="text-red-500 text-sm hover:text-red-700"
              >
                删除
              </button>
            </div>
          </div>
        ))}
        {agents.length === 0 && <p className="text-center text-sm text-gray-400">暂无 Agent</p>}
      </div>

      {editing && (
        <AgentSettings
          agent={editing}
          onClose={() => setEditing(null)}
          onSaved={fetchAgents}
        />
      )}
    </div>
  );
}
