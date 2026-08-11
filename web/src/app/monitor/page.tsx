'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Trace {
  trace_id: string;
  task_id: string;
  agent_id: string;
  agent_version: string;
  status: string;
  score?: number | null;
  cost?: number | null;
  received_at?: number;
}

interface CostSummary {
  total_cost: number;
  total_traces: number;
  by_agent: Record<string, { count: number; cost: number }>;
}

interface AgentItem {
  agentId: string;
  name: string;
  project_id: string;
}

interface PenguinTrace {
  date: string;
  sessions: { sessionId: string; files: unknown[] }[];
}

export default function MonitorPage() {
  const { t } = useI18n();
  const [traces, setTraces] = useState<Trace[]>([]);
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [penguinAgent, setPenguinAgent] = useState('');
  const [penguinTraces, setPenguinTraces] = useState<PenguinTrace[]>([]);

  const load = () => {
    apiGet<{ traces: Trace[] }>('/api/traces?limit=100').then(d => setTraces(d.traces)).catch(console.error);
    apiGet<CostSummary>('/api/cost/summary').then(setCost).catch(console.error);
    apiGet<{ agents: AgentItem[] }>('/api/agents')
      .then(d => {
        const seen = new Set<string>();
        const unique = d.agents.filter(a => {
          if (seen.has(a.agentId)) return false;
          seen.add(a.agentId);
          return true;
        });
        setAgents(unique);
        if (!penguinAgent && unique.length > 0) setPenguinAgent(unique[0].agentId);
      })
      .catch(console.error);
  };

  useEffect(load, []);

  // 加载真实 penguin 轨迹
  useEffect(() => {
    if (!penguinAgent) return;
    const agent = agents.find(a => a.agentId === penguinAgent);
    apiGet<{ dates: PenguinTrace[] }>(`/api/traces/penguin/${penguinAgent}?project_id=${agent?.project_id ?? 'default_project'}`)
      .then(d => setPenguinTraces(d.dates ?? []))
      .catch(() => setPenguinTraces([]));
  }, [penguinAgent, agents]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.nav.monitor}</h1>
        <button onClick={load} className="rounded bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700">
          刷新
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 成本统计 */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 font-semibold">💸 成本统计</h2>
          {cost ? (
            <>
              <p className="mb-3 text-2xl font-bold text-amber-600">${cost.total_cost}</p>
              <div className="space-y-2">
                {Object.entries(cost.by_agent).map(([agent, v]) => (
                  <div key={agent} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{agent}</span>
                    <span className="text-gray-800">
                      {v.count} 次 · ${v.cost}
                    </span>
                  </div>
                ))}
                {Object.keys(cost.by_agent).length === 0 && (
                  <p className="text-sm text-gray-400">暂无成本数据</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">加载中…</p>
          )}
        </div>

        {/* Trace 列表 */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 lg:col-span-2">
          <h2 className="mb-3 font-semibold">📜 Trace 数据流</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2">Trace ID</th>
                  <th className="pb-2">Agent</th>
                  <th className="pb-2">状态</th>
                  <th className="pb-2">得分</th>
                  <th className="pb-2">成本</th>
                </tr>
              </thead>
              <tbody>
                {traces.map(t => (
                  <tr key={t.trace_id} className="border-b border-gray-100">
                    <td className="py-2 font-mono text-xs">{t.trace_id.slice(0, 8)}</td>
                    <td className="py-2">{t.agent_id}@{t.agent_version}</td>
                    <td className="py-2">
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
                    </td>
                    <td className="py-2">{t.score ?? '-'}</td>
                    <td className="py-2">{t.cost ? `$${t.cost}` : '-'}</td>
                  </tr>
                ))}
                {traces.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400">
                      暂无 Trace（等待 DeerFlow 上报）
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 真实 PenguinHarness 轨迹 */}
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">🐧 PenguinHarness 真实轨迹</h2>
          <select
            value={penguinAgent}
            onChange={e => setPenguinAgent(e.target.value)}
            className="rounded border border-gray-300 p-1.5 text-xs"
          >
            {agents.map(a => (
              <option key={`${a.project_id}/${a.agentId}`} value={a.agentId}>
                {a.name}（{a.agentId}）
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {penguinTraces.map(day => (
            <div key={day.date} className="rounded border border-gray-100 p-3">
              <p className="mb-2 text-sm font-medium text-gray-700">📅 {day.date}</p>
              <div className="space-y-1.5">
                {day.sessions.map(s => (
                  <div key={s.sessionId} className="flex items-center justify-between text-xs text-gray-500">
                    <span className="font-mono">{s.sessionId.slice(-10)}</span>
                    <span>{s.files.length} 个轨迹文件</span>
                  </div>
                ))}
                {day.sessions.length === 0 && <p className="text-xs text-gray-400">无会话</p>}
              </div>
            </div>
          ))}
          {penguinTraces.length === 0 && (
            <p className="text-sm text-gray-400 md:col-span-3">该 Agent 暂无真实轨迹（对话后生成）</p>
          )}
        </div>
      </div>
    </div>
  );
}
