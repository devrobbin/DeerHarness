'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useWebSocket } from '@/lib/useWebSocket';
import { Badge } from '@/components/ui';

interface Trace {
  trace_id: string;
  agent_id: string;
  agent_version: string;
  status: string;
  score?: number | null;
  cost?: number | null;
  task_goal?: string;
  received_at?: number;
  delegations?: number;
  delegations_failed?: number;
  thread_id?: string;
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

interface Health {
  gateway: { status: string };
  penguin: { status: string; version?: string };
  deerflow: { status: string };
}

interface EvolveTask {
  task_id: string;
  target: string;
  status: string;
  last_avg_score: number | null;
  current_round: number;
  max_rounds: number;
}

const EVOLVE_COLORS: Record<string, 'green' | 'red' | 'gray' | 'purple' | 'amber'> = {
  running: 'purple', waiting_approval: 'amber', success: 'green', stopped: 'gray', failed: 'red',
};

function traceType(agentId: string): 'chat' | 'team' | 'evolve' | 'other' {
  if (agentId.startsWith('dh-team')) return 'team';
  if (agentId.startsWith('eval:') || agentId.startsWith('evolve:')) return 'evolve';
  if (agentId.startsWith('dh-chat') || agentId.startsWith('dh-fusion')) return 'chat';
  return 'other';
}


export default function MonitorPage() {
  const { t } = useI18n();
  const [traces, setTraces] = useState<Trace[]>([]);
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [evolveTasks, setEvolveTasks] = useState<EvolveTask[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [penguinAgent, setPenguinAgent] = useState('');
  const [penguinTraces, setPenguinTraces] = useState<PenguinTrace[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // 实时事件流（WS 全局频道）
  const { messages: liveEvents, connected } = useWebSocket();
  const liveTraces = useMemo(
    () => liveEvents.filter(e => e?.type === 'trace').map(e => e.data).slice(-30),
    [liveEvents],
  );

  const load = () => {
    apiGet<{ traces: Trace[] }>('/api/traces?limit=200').then(d => setTraces(d.traces)).catch(console.error);
    apiGet<CostSummary>('/api/cost/summary').then(setCost).catch(console.error);
    apiGet<Health>('/api/dashboard/health').then(setHealth).catch(console.error);
    apiGet<{ tasks: EvolveTask[] }>('/api/evolution/tasks').then(d => setEvolveTasks(d.tasks ?? [])).catch(console.error);
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

  // 团队编排统计（dh-team 轨迹）
  const teamTraces = useMemo(() => traces.filter(x => traceType(x.agent_id) === 'team'), [traces]);
  const teamStats = useMemo(() => {
    const total = teamTraces.length;
    const failed = teamTraces.filter(x => x.status === 'failed').length;
    const delegations = teamTraces.reduce((s, x) => s + (x.delegations ?? 0), 0);
    const delegationsFailed = teamTraces.reduce((s, x) => s + (x.delegations_failed ?? 0), 0);
    return { total, failed, delegations, delegationsFailed };
  }, [teamTraces]);

  // 进化统计
  const evolveStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const task of evolveTasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
    return counts;
  }, [evolveTasks]);

  // 过滤后的 Trace
  const filteredTraces = useMemo(
    () => traces.filter(x =>
      (!typeFilter || traceType(x.agent_id) === typeFilter) &&
      (!statusFilter || x.status === statusFilter)),
    [traces, typeFilter, statusFilter],
  );

  const time = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleTimeString() : '');

  const panel = 'rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800';

  return (
    <div className="space-y-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold dark:text-gray-100">{t.nav.monitor}</h1>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1 text-sm ${connected ? 'text-green-500' : 'text-red-400'}`}>
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
            {connected ? t.monitor.liveConnected : t.monitor.offline}
          </span>
          <button onClick={load} className="rounded bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700">
            {t.monitor.refresh}
          </button>
        </div>
      </div>

      {/* 第一行：健康 / 成本 / 进化 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className={panel}>
          <h2 className="mb-3 font-semibold dark:text-gray-100">{t.monitor.health}</h2>
          {health && (
            <div className="space-y-2 text-sm">
              {Object.entries(health).map(([name, h]) => (
                <div key={name} className="flex items-center justify-between">
                  <span className="text-gray-600 dark:text-gray-300">{name}{h.version ? ` v${h.version}` : ''}</span>
                  <Badge color={h.status === 'up' ? 'green' : h.status === 'down' ? 'red' : 'amber'}>{h.status}</Badge>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
            <p className="mb-1.5 text-xs text-gray-500 dark:text-gray-400">🧬 进化任务</p>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {Object.entries(evolveStats).map(([s, n]) => {
                const text = (t.monitor.evolveStatus as Record<string, string>)[s] ?? s;
                const color = EVOLVE_COLORS[s] ?? 'gray';
                return <Badge key={s} color={color}>{text} {n}</Badge>;
              })}
              {evolveTasks.length === 0 && <span className="text-gray-400">暂无</span>}
            </div>
          </div>
        </div>

        <div className={panel}>
          <h2 className="mb-3 font-semibold dark:text-gray-100">{t.monitor.cost}</h2>
          {cost ? (
            <>
              <p className="mb-1 text-2xl font-bold text-amber-600">${cost.total_cost}</p>
              <p className="mb-3 text-xs text-gray-400">{cost.total_traces} 条轨迹</p>
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {Object.entries(cost.by_agent).sort((a, b) => b[1].cost - a[1].cost).map(([agent, v]) => (
                  <div key={agent} className="flex items-center justify-between text-xs">
                    <span className="truncate text-gray-600 dark:text-gray-300">{agent}</span>
                    <span className="text-gray-800 dark:text-gray-100">{v.count} 次 · ${v.cost}</span>
                  </div>
                ))}
                {Object.keys(cost.by_agent).length === 0 && <p className="text-xs text-gray-400">暂无成本数据</p>}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">加载中…</p>
          )}
        </div>

        <div className={panel}>
          <h2 className="mb-3 font-semibold dark:text-gray-100">{t.monitor.evolution}</h2>
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {evolveTasks.slice(0, 8).map(task => {
              const text = (t.monitor.evolveStatus as Record<string, string>)[task.status] ?? task.status;
              const color = EVOLVE_COLORS[task.status] ?? 'gray';
              return (
                <div key={task.task_id} className="rounded border border-gray-100 p-1.5 text-xs dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-gray-700 dark:text-gray-200">{task.target}</span>
                    <Badge color={color}>{text}</Badge>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    第 {task.current_round}/{task.max_rounds} 轮 · 最新 {task.last_avg_score ?? '—'} 分
                  </p>
                </div>
              );
            })}
            {evolveTasks.length === 0 && <p className="text-xs text-gray-400">暂无进化任务</p>}
          </div>
        </div>
      </div>

      {/* 第二行：团队编排监控 / 实时事件流 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className={panel}>
          <h2 className="mb-3 font-semibold dark:text-gray-100">{t.monitor.team}</h2>
          <div className="mb-3 grid grid-cols-4 gap-2 text-center">
            {[
              { label: t.monitor.teamRuns, value: teamStats.total },
              { label: t.monitor.delegations, value: teamStats.delegations },
              { label: t.monitor.delegFailed, value: teamStats.delegationsFailed },
              { label: t.monitor.failRate, value: teamStats.total ? `${Math.round((teamStats.failed / teamStats.total) * 100)}%` : '—' },
            ].map(s => (
              <div key={s.label} className="rounded bg-gray-50 p-2 dark:bg-gray-700/50">
                <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{s.value}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {teamTraces.slice(0, 8).map(x => (
              <div key={x.trace_id} className="rounded border border-gray-100 p-1.5 text-xs dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <span className="truncate text-gray-700 dark:text-gray-200">{x.task_goal || x.thread_id || x.trace_id.slice(0, 12)}</span>
                  <Badge color={x.status === 'success' ? 'green' : 'red'}>{x.status}</Badge>
                </div>
                <p className="text-[11px] text-gray-400">
                  {x.delegations ?? 0} 次分派 · {x.delegations_failed ?? 0} 失败 · {time(x.received_at)}
                </p>
              </div>
            ))}
            {teamTraces.length === 0 && <p className="text-xs text-gray-400">暂无团队编排记录</p>}
          </div>
        </div>

        <div className={panel}>
          <h2 className="mb-3 font-semibold dark:text-gray-100">{t.monitor.live}</h2>
          <div className="h-64 overflow-y-auto rounded bg-gray-900 p-3 font-mono text-[11px] leading-relaxed dark:bg-black">
            {liveTraces.map((e, i) => (
              <p key={i} className={e.status === 'failed' ? 'text-red-400' : e.agent_id.startsWith('eval') || e.agent_id.startsWith('evolve') ? 'text-purple-300' : 'text-green-300'}>
                <span className="text-gray-500">[{time(e.received_at)}]</span> {e.agent_id}
                {e.status !== 'success' && ` [${e.status}]`}
                {e.score != null && ` · ${e.score}分`}
                {e.cost != null && ` · $${e.cost}`}
                {e.task_goal ? ` · ${String(e.task_goal).slice(0, 30)}` : ''}
              </p>
            ))}
            {liveTraces.length === 0 && <p className="text-gray-500">等待实时事件…（对话 / 团队编排 / 进化都会出现在这里）</p>}
          </div>
        </div>
      </div>

      {/* 第三行：Trace 数据流 + penguin 轨迹 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className={`${panel} lg:col-span-2`}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold dark:text-gray-100">{t.monitor.traces}</h2>
            <div className="flex gap-2">
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="rounded border border-gray-300 p-1.5 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100">
                <option value="">{t.monitor.allTypes}</option>
                {Object.entries(t.monitor.traceType).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="rounded border border-gray-300 p-1.5 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100">
                <option value="">{t.monitor.allStatus}</option>
                <option value="success">success</option>
                <option value="failed">failed</option>
              </select>
            </div>
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500 dark:border-gray-700">
                  <th className="pb-2">Trace ID</th>
                  <th className="pb-2">Agent</th>
                  <th className="pb-2">状态</th>
                  <th className="pb-2">得分</th>
                  <th className="pb-2">成本</th>
                  <th className="pb-2">时间</th>
                </tr>
              </thead>
              <tbody>
                {filteredTraces.map(x => (
                  <tr key={x.trace_id} className="border-b border-gray-100 dark:border-gray-700">
                    <td className="py-2 font-mono text-xs">{x.trace_id.slice(0, 8)}</td>
                    <td className="py-2 text-xs">{x.agent_id}@{x.agent_version}</td>
                    <td className="py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${x.status === 'success' ? 'bg-green-100 text-green-700' : x.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                        {x.status}
                      </span>
                    </td>
                    <td className="py-2">{x.score ?? '-'}</td>
                    <td className="py-2">{x.cost ? `$${x.cost}` : '-'}</td>
                    <td className="py-2 text-xs text-gray-400">{time(x.received_at)}</td>
                  </tr>
                ))}
                {filteredTraces.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-400">暂无 Trace</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className={panel}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold dark:text-gray-100">{t.monitor.penguin}</h2>
            <select value={penguinAgent} onChange={e => setPenguinAgent(e.target.value)} className="rounded border border-gray-300 p-1.5 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100">
              {agents.map(a => (
                <option key={`${a.project_id}/${a.agentId}`} value={a.agentId}>{a.name}（{a.agentId}）</option>
              ))}
            </select>
          </div>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {penguinTraces.map(day => (
              <div key={day.date} className="rounded border border-gray-100 p-2.5 dark:border-gray-700">
                <p className="mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-200">📅 {day.date}</p>
                <div className="space-y-1">
                  {day.sessions.map(s => (
                    <div key={s.sessionId} className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span className="font-mono">{s.sessionId.slice(-10)}</span>
                      <span>{s.files.length} 个轨迹文件</span>
                    </div>
                  ))}
                  {day.sessions.length === 0 && <p className="text-xs text-gray-400">无会话</p>}
                </div>
              </div>
            ))}
            {penguinTraces.length === 0 && <p className="text-sm text-gray-400">该 Agent 暂无真实轨迹（对话后生成）</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
