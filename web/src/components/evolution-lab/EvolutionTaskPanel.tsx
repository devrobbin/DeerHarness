'use client';

import React, { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { Badge, Button, Input, Spinner, tokens } from '@/components/ui';

interface TeamTemplate {
  name: string;
  icon: string;
  description: string;
  workflows: { id: string; label: string }[];
}

interface EvolveTask {
  task_id: string;
  target_type: 'agent' | 'workflow' | 'team';
  target: string;
  team_id: string;
  workflow_id: string;
  agent_id: string;
  max_rounds: number;
  target_score: number;
  status: string;
  current_round: number;
  last_avg_score: number | null;
  cost: number;
  created_at: number;
}

interface AgentItem {
  agentId: string;
  name: string;
}

interface EvolutionTaskPanelProps {
  onTaskSelected: (taskId: string) => void;
  selectedTaskId: string;
}

const STATUS_BADGE: Record<string, { text: string; color: 'green' | 'red' | 'gray' | 'purple' | 'amber' }> = {
  running: { text: '运行中', color: 'purple' },
  waiting_approval: { text: '待审批', color: 'amber' },
  success: { text: '成功', color: 'green' },
  stopped: { text: '已停止', color: 'gray' },
  failed: { text: '失败', color: 'red' },
};

/** 进化任务面板：三层目标（Agent / 工作流 / 团队）选择 + 启动 + 任务列表 */
export function EvolutionTaskPanel({ onTaskSelected, selectedTaskId }: EvolutionTaskPanelProps) {
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [tasks, setTasks] = useState<EvolveTask[]>([]);
  const [targetType, setTargetType] = useState<'agent' | 'workflow' | 'team'>('workflow');
  const [teamId, setTeamId] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [maxRounds, setMaxRounds] = useState(2);
  const [targetScore, setTargetScore] = useState(85);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    apiGet<{ tasks: EvolveTask[] }>('/api/evolution/tasks')
      .then(d => setTasks(d.tasks ?? []))
      .catch(() => {});
  };

  useEffect(() => {
    apiGet<{ templates: TeamTemplate[] }>('/api/fusion/team/templates')
      .then(d => {
        setTemplates(d.templates ?? []);
        if (d.templates?.length > 0) {
          setTeamId(d.templates[0].name);
          setWorkflowId(d.templates[0].workflows[0]?.id ?? '');
        }
      })
      .catch(() => {});
    apiGet<{ agents: AgentItem[] }>('/api/agents')
      .then(d => {
        const seen = new Set<string>();
        const unique = (d.agents ?? []).filter(a => (seen.has(a.agentId) ? false : (seen.add(a.agentId), true)));
        setAgents(unique);
        if (unique.length > 0) setAgentId(unique[0].agentId);
      })
      .catch(() => {});
    load();
  }, []);

  const activeTemplate = templates.find(t => t.name === teamId);

  const handleStart = async () => {
    setStarting(true);
    setError('');
    try {
      const body: Record<string, unknown> = { target_type: targetType, max_rounds: maxRounds, target_score: targetScore };
      if (targetType === 'workflow' || targetType === 'team') body.team_id = teamId;
      if (targetType === 'workflow') body.workflow_id = workflowId;
      if (targetType === 'agent') body.agent_id = agentId;
      const data = await apiPost<{ task_id: string }>('/api/evolution/start', body);
      onTaskSelected(data.task_id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async (taskId: string) => {
    try { await apiPost(`/api/evolution/tasks/${taskId}/stop`); load(); } catch { /* ignore */ }
  };

  const label = 'mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold dark:text-gray-100">🧬 进化目标</h2>
        <button onClick={load} className="text-xs text-blue-500 hover:text-blue-700">刷新</button>
      </div>

      {/* 目标类型 */}
      <div className="mb-3 flex gap-1.5">
        {(['agent', 'workflow', 'team'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTargetType(t)}
            className={`rounded-full px-3 py-1 text-xs transition ${
              targetType === t ? 'bg-purple-500 font-medium text-white' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            {t === 'agent' ? '🤖 Agent' : t === 'workflow' ? '⚙️ 工作流' : '🏢 团队'}
          </button>
        ))}
      </div>

      {/* 目标选择 */}
      <div className="mb-3 space-y-2">
        {targetType !== 'agent' && (
          <div>
            <label className={label}>团队</label>
            <select
              value={teamId}
              onChange={e => {
                setTeamId(e.target.value);
                const t = templates.find(x => x.name === e.target.value);
                setWorkflowId(t?.workflows[0]?.id ?? '');
              }}
              className={tokens.input}
            >
              {templates.map(t => <option key={t.name} value={t.name}>{t.icon} {t.description.split('：')[0]}</option>)}
            </select>
          </div>
        )}
        {targetType === 'workflow' && (
          <div>
            <label className={label}>工作流（同团队不同流程）</label>
            <select value={workflowId} onChange={e => setWorkflowId(e.target.value)} className={tokens.input}>
              {(activeTemplate?.workflows ?? []).map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-gray-400">进化该工作流的任务模板（workflow.task）</p>
          </div>
        )}
        {targetType === 'team' && (
          <p className="text-[11px] text-gray-400">进化团队主代理 soul 与成员人设</p>
        )}
        {targetType === 'agent' && (
          <div>
            <label className={label}>Agent</label>
            <select value={agentId} onChange={e => setAgentId(e.target.value)} className={tokens.input}>
              {agents.map(a => <option key={a.agentId} value={a.agentId}>{a.name}（{a.agentId}）</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={label}>最大轮次</label>
            <Input type="number" min={1} max={20} value={maxRounds} onChange={e => setMaxRounds(+e.target.value)} />
          </div>
          <div>
            <label className={label}>目标分（达标即止）</label>
            <Input type="number" min={1} max={100} value={targetScore} onChange={e => setTargetScore(+e.target.value)} />
          </div>
        </div>
      </div>

      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</p>}
      <Button onClick={handleStart} disabled={starting || (targetType === 'workflow' && !workflowId)}>
        {starting ? <Spinner label="启动中…" /> : '🚀 启动进化'}
      </Button>

      {/* 任务列表 */}
      <div className="mt-4 space-y-1.5">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">📋 进化任务（{tasks.length}）</p>
        {tasks.map(t => {
          const badge = STATUS_BADGE[t.status] ?? { text: t.status, color: 'gray' as const };
          return (
            <div
              key={t.task_id}
              onClick={() => onTaskSelected(t.task_id)}
              className={`cursor-pointer rounded border p-2 text-xs transition ${
                selectedTaskId === t.task_id
                  ? 'border-purple-400 bg-purple-50 dark:border-purple-600 dark:bg-purple-900/30'
                  : 'border-gray-100 hover:border-purple-200 dark:border-gray-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{t.task_id.slice(0, 20)}</span>
                <Badge color={badge.color}>{badge.text}</Badge>
              </div>
              <p className="mt-1 text-gray-700 dark:text-gray-200">
                {t.target_type === 'agent' ? '🤖 ' : t.target_type === 'workflow' ? '⚙️ ' : '🏢 '}
                {t.target} · 目标 {t.target_score} 分
              </p>
              <p className="text-[11px] text-gray-400">
                第 {t.current_round}/{t.max_rounds} 轮 · 最新 {t.last_avg_score ?? '—'} 分 · 成本 ${t.cost}
              </p>
              {t.status === 'running' && (
                <button onClick={e => { e.stopPropagation(); handleStop(t.task_id); }} className="mt-1 text-[11px] text-red-500 hover:text-red-700">
                  停止
                </button>
              )}
            </div>
          );
        })}
        {tasks.length === 0 && <p className="text-center text-xs text-gray-400">暂无进化任务</p>}
      </div>
    </div>
  );
}
