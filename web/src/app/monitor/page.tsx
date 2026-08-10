'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

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

export default function MonitorPage() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [cost, setCost] = useState<CostSummary | null>(null);

  const load = () => {
    apiGet<{ traces: Trace[] }>('/api/traces?limit=100').then(d => setTraces(d.traces)).catch(console.error);
    apiGet<CostSummary>('/api/cost/summary').then(setCost).catch(console.error);
  };

  useEffect(load, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">🛰️ Monitor</h1>
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
    </div>
  );
}
