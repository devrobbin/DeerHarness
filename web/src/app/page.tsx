'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

interface Summary {
  agents: number;
  tasks: number;
  tasks_success: number;
  tasks_failed: number;
  traces: number;
  total_cost: number;
}

interface Health {
  gateway: { status: string };
  penguin: { status: string };
  deerflow: { status: string };
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    apiGet<Summary>('/api/dashboard/summary').then(setSummary).catch(console.error);
    apiGet<Health>('/api/dashboard/health').then(setHealth).catch(console.error);
  }, []);

  const cards = summary
    ? [
        { label: 'Agent 数量', value: summary.agents, color: 'text-blue-600' },
        { label: '任务总数', value: summary.tasks, color: 'text-gray-800' },
        { label: '成功', value: summary.tasks_success, color: 'text-green-600' },
        { label: '失败', value: summary.tasks_failed, color: 'text-red-500' },
        { label: 'Trace 数', value: summary.traces, color: 'text-purple-600' },
        { label: '总成本 ($)', value: summary.total_cost, color: 'text-amber-600' },
      ]
    : [];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">📊 Dashboard</h1>

      {/* 健康检查 */}
      <div className="mb-6 flex flex-wrap gap-3">
        {health &&
          (Object.entries(health) as [string, { status: string }][]).map(([name, h]) => (
            <span
              key={name}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium ${
                h.status === 'up'
                  ? 'bg-green-100 text-green-700'
                  : h.status === 'down'
                    ? 'bg-red-100 text-red-600'
                    : 'bg-amber-100 text-amber-700'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${h.status === 'up' ? 'bg-green-500' : h.status === 'down' ? 'bg-red-500' : 'bg-amber-500'}`} />
              {name}: {h.status}
            </span>
          ))}
      </div>

      {/* 聚合统计 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {cards.map(c => (
          <div key={c.label} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">{c.label}</p>
            <p className={`mt-1 text-2xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {!summary && <p className="mt-8 text-center text-gray-400">加载中…（请确认 Gateway 已启动）</p>}
    </div>
  );
}
