'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Badge } from '@/components/ui';

interface Summary {
  agents: number;
  tasks: number;
  tasks_success: number;
  tasks_failed: number;
  traces: number;
  total_cost: number;
  team: { runs: number; delegations: number; delegations_failed: number };
  evolution: Record<string, number>;
  daily_cost: { day: string; cost: number }[];
  recent_scores: { agent_id: string; score: number; received_at?: number }[];
}

interface Health {
  gateway: { status: string };
  penguin: { status: string; version?: string };
  deerflow: { status: string };
}

interface Trace {
  trace_id: string;
  agent_id: string;
  status: string;
  score?: number | null;
  cost?: number | null;
  task_goal?: string;
  received_at?: number;
}

const EVOLVE_STATUS: Record<string, { text: string; color: 'green' | 'red' | 'gray' | 'purple' | 'amber' }> = {
  running: { text: '运行中', color: 'purple' },
  waiting_approval: { text: '待审批', color: 'amber' },
  success: { text: '成功', color: 'green' },
  stopped: { text: '已停止', color: 'gray' },
  failed: { text: '失败', color: 'red' },
};

function traceType(agentId: string): 'chat' | 'team' | 'evolve' | 'other' {
  if (agentId.startsWith('dh-team')) return 'team';
  if (agentId.startsWith('eval:') || agentId.startsWith('evolve:')) return 'evolve';
  if (agentId.startsWith('dh-chat') || agentId.startsWith('dh-fusion')) return 'chat';
  return 'other';
}

export default function DashboardPage() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [recent, setRecent] = useState<Trace[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    apiGet<Summary>('/api/dashboard/summary').then(setSummary).catch(console.error);
    apiGet<Health>('/api/dashboard/health').then(setHealth).catch(console.error);
    apiGet<{ traces: Trace[] }>('/api/traces?limit=12').then(d => setRecent(d.traces ?? [])).catch(console.error);
    apiGet<{ tasks: { status: string }[] }>('/api/evolution/tasks')
      .then(d => setPendingApprovals((d.tasks ?? []).filter(x => x.status === 'waiting_approval').length))
      .catch(() => {});
  }, []);

  const cards = summary
    ? [
        { label: t.dashboard.agents, value: summary.agents, color: 'text-blue-600', icon: '🤖' },
        { label: t.dashboard.tasks, value: summary.tasks, color: 'text-gray-800 dark:text-gray-100', icon: '📋' },
        { label: t.dashboard.success, value: summary.tasks_success, color: 'text-green-600', icon: '✅' },
        { label: t.dashboard.failed, value: summary.tasks_failed, color: 'text-red-500', icon: '❌' },
        { label: t.dashboard.traces, value: summary.traces, color: 'text-purple-600', icon: '📜' },
        { label: t.dashboard.totalCost, value: summary.total_cost, color: 'text-amber-600', icon: '💰' },
        { label: t.dashboard.teamRuns, value: summary.team.runs, color: 'text-purple-600', icon: '🧭' },
        { label: t.dashboard.pendingApproval, value: pendingApprovals, color: 'text-amber-600', icon: '🛂' },
      ]
    : [];

  const maxDayCost = Math.max(1, ...(summary?.daily_cost ?? []).map(d => d.cost));
  const maxScore = 100;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold dark:text-gray-100">{t.nav.dashboard}</h1>

      {/* 健康检查 + 快捷入口 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          {health &&
            (Object.entries(health) as [string, { status: string; version?: string }][]).map(([name, h]) => (
              <span key={name} className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs dark:border-gray-700 dark:bg-gray-800">
                <span className={`h-2 w-2 rounded-full ${h.status === 'up' ? 'bg-green-500' : h.status === 'down' ? 'bg-red-500' : 'bg-amber-500'}`} />
                <span className="text-gray-600 dark:text-gray-300">{name}</span>
                {h.version && <span className="text-gray-400">v{h.version}</span>}
                <Badge color={h.status === 'up' ? 'green' : h.status === 'down' ? 'red' : 'amber'}>{h.status}</Badge>
              </span>
            ))}
        </div>
        <div className="flex gap-2 text-xs">
          {[
            { href: '/chat', label: '💬 对话' },
            { href: '/studio', label: '🧪 工作室' },
            { href: '/evolution', label: '🧬 进化' },
            { href: '/monitor', label: '🛰️ 监控' },
          ].map(x => (
            <Link key={x.href} href={x.href} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-gray-600 hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {x.label}
            </Link>
          ))}
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map(c => (
          <div key={c.label} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">{c.icon} {c.label}</p>
            <p className={`mt-1 text-2xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* 第二行：7 日成本趋势 / 评测得分 / 进化状态 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 font-semibold dark:text-gray-100">{t.dashboard.costTrend}</h2>
          <div className="flex h-32 items-end gap-2">
            {(summary?.daily_cost ?? []).map(d => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] text-amber-600">{d.cost > 0 ? `$${d.cost}` : ''}</span>
                <div
                  className="w-full rounded-t bg-gradient-to-t from-amber-400 to-amber-300"
                  style={{ height: `${Math.max(4, (d.cost / maxDayCost) * 100)}%` }}
                />
                <span className="text-[10px] text-gray-400">{d.day}</span>
              </div>
            ))}
            {(summary?.daily_cost ?? []).length === 0 && <p className="text-sm text-gray-400">暂无数据</p>}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 font-semibold dark:text-gray-100">{t.dashboard.scoreTrend}</h2>
          <div className="space-y-1.5">
            {(summary?.recent_scores ?? []).slice().reverse().map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-28 truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">{s.agent_id.replace('eval:', '').replace('evolve:', '').slice(0, 18)}</span>
                <div className="h-3 flex-1 rounded bg-gray-100 dark:bg-gray-700">
                  <div
                    className={`h-3 rounded ${(s.score ?? 0) >= 60 ? 'bg-green-400' : (s.score ?? 0) >= 30 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${Math.max(4, ((s.score ?? 0) / maxScore) * 100)}%` }}
                  />
                </div>
                <span className="w-8 text-right text-[11px] text-gray-600 dark:text-gray-300">{s.score}</span>
              </div>
            ))}
            {(summary?.recent_scores ?? []).length === 0 && <p className="text-sm text-gray-400">暂无评测记录（去进化实验室跑一次）</p>}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 font-semibold dark:text-gray-100">{t.dashboard.teamPanel}</h2>
          {summary && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: '运行', value: summary.team.runs },
                  { label: '分派', value: summary.team.delegations },
                  { label: '分派失败', value: summary.team.delegations_failed },
                ].map(s => (
                  <div key={s.label} className="rounded bg-gray-50 p-2 dark:bg-gray-700/50">
                    <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{s.value}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
                <p className="mb-1.5 text-xs text-gray-500 dark:text-gray-400">进化任务状态</p>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {Object.entries(summary.evolution).map(([s, n]) => {
                    const b = EVOLVE_STATUS[s] ?? { text: s, color: 'gray' as const };
                    return <Badge key={s} color={b.color}>{b.text} {n}</Badge>;
                  })}
                  {Object.keys(summary.evolution).length === 0 && <span className="text-gray-400">暂无进化任务</span>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 近期动态 */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold dark:text-gray-100">{t.dashboard.recent}</h2>
          <Link href="/monitor" className="text-xs text-blue-500 hover:text-blue-700">{t.dashboard.viewMonitor}</Link>
        </div>
        <div className="space-y-1.5">
          {recent.map(x => {
            const type = traceType(x.agent_id);
            const icon = type === 'chat' ? '💬' : type === 'team' ? '🧭' : type === 'evolve' ? '🧬' : '⚙️';
            return (
              <div key={x.trace_id} className="flex items-center gap-2 rounded border border-gray-100 px-2.5 py-1.5 text-xs dark:border-gray-700">
                <span>{icon}</span>
                <span className="w-32 truncate font-mono text-gray-500 dark:text-gray-400">{x.agent_id}</span>
                <span className="flex-1 truncate text-gray-600 dark:text-gray-300">{x.task_goal || x.trace_id.slice(0, 12)}</span>
                <Badge color={x.status === 'success' ? 'green' : x.status === 'failed' ? 'red' : 'gray'}>{x.status}</Badge>
                {x.score != null && <span className="text-purple-500">{x.score}分</span>}
                {x.cost != null && <span className="text-amber-600">${x.cost}</span>}
                {x.received_at && <span className="text-gray-400">{new Date(x.received_at * 1000).toLocaleTimeString()}</span>}
              </div>
            );
          })}
          {recent.length === 0 && <p className="text-sm text-gray-400">{t.dashboard.noRecent}</p>}
        </div>
      </div>
    </div>
  );
}
