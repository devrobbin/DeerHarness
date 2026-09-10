'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { Markdown } from '@/components/Markdown';
import { FlowGraph } from '@/components/agent-studio/FlowGraph';

interface AgentItem {
  agentId: string;
  name: string;
  project_id: string;
}

interface Workflow {
  id: string;
  label: string;
  task: string;
}

interface TeamTemplate {
  name: string;
  icon: string;
  description: string;
  members: string[] | null; // null = 全部 Agent
  workflows: Workflow[];
  custom?: boolean;
  version?: number;
}

interface TemplateAsset {
  name: string;
  icon?: string;
  description?: string;
  members?: string[] | null;
  soul: string;
  workflows: { id: string; label: string; task: string }[];
}

interface TeamResult {
  reply: string;
  status: string;
  team: string[];
  delegations: { tool: string; result: string }[];
  thread_id?: string;
}

interface MemberStatus {
  agent_id: string;
  state: 'idle' | 'working' | 'done' | 'failed';
  task_count: number;
}

/**
 * 多 Agent 团队编排（团队模式）：主代理（DeerFlow）把子任务分派给
 * 团队成员（PenguinHarness Agent 子代理）。
 *
 * - 不同团队：选择团队模板（跨域总监 / Amazon 专项 / TikTok 专项 / 内容工厂 / 履约财税），
 *   自动切换编排主代理 + 团队成员班底
 * - 同团队不同工作流：选中模板内置工作流预设，任务框自动填充可编辑
 */
export function TeamOrchestrator() {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState('');
  const [workflow, setWorkflow] = useState('');
  const [task, setTask] = useState('');
  const [loading, setLoading] = useState(false);
  // 非阻塞编排：实时成员状态（轮询 /team/status）
  const [memberStatus, setMemberStatus] = useState<Record<string, MemberStatus>>({});
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) { window.clearTimeout(pollRef.current); pollRef.current = null; }
  };
  useEffect(() => stopPolling, []);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TeamResult | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 模板资产化：导入 / 导出（P3）
  const fileRef = useRef<HTMLInputElement>(null);
  const [assetMsg, setAssetMsg] = useState('');

  const handleExport = async () => {
    if (!template) { setAssetMsg('请先选择一个团队模板再导出'); return; }
    try {
      const asset = await apiGet<TemplateAsset>(`/api/fusion/team/templates/${template}/export`);
      const blob = new Blob([JSON.stringify(asset, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `team-template-${template}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setAssetMsg(`已导出模板 ${template}`);
    } catch (err) {
      setAssetMsg(`导出失败：${err instanceof Error ? err.message : err}`);
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const asset = JSON.parse(text) as TemplateAsset;
      if (!asset?.name || !asset?.soul || !Array.isArray(asset?.workflows)) {
        setAssetMsg('模板格式无效：需含 name / soul / workflows');
        return;
      }
      const res = await apiPost<{ success: boolean; name: string }>('/api/fusion/team/templates/import', {
        name: asset.name,
        icon: asset.icon || '🧭',
        description: asset.description || '',
        members: asset.members ?? null,
        soul: asset.soul,
        workflows: asset.workflows,
      });
      setAssetMsg(`已导入模板 ${res.name}`);
      await refreshTemplates();
    } catch (err) {
      setAssetMsg(`导入失败：${err instanceof Error ? err.message : err}`);
    }
  };

  // 定时巡检：DeerFlow Scheduler 接入（P4）
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleCron, setScheduleCron] = useState('0 9 * * *');
  const [scheduleTz, setScheduleTz] = useState('Asia/Shanghai');
  const [scheduleMsg, setScheduleMsg] = useState('');

  const handleSchedule = async () => {
    if (!template) { setScheduleMsg('请先选择团队模板'); return; }
    try {
      const res = await apiPost<{ success: boolean; assistant_id: string }>('/api/fusion/team/schedule', {
        team_id: template,
        workflow_id: workflow || undefined,
        prompt: task.trim() || undefined,
        schedule_type: 'cron',
        schedule_spec: { cron: scheduleCron },
        timezone: scheduleTz,
      });
      setScheduleMsg(`✅ 已创建定时巡检（主代理 ${res.assistant_id}）`);
    } catch (err) {
      setScheduleMsg(`创建失败：${err instanceof Error ? err.message : err}`);
    }
  };

  // 定时任务列表 + 执行历史（P6）
  interface ScheduleItem { id: string; title?: string; status?: string; next_run_at?: string; assistant_id?: string }
  interface ScheduleRun { id?: string; run_id?: string; status?: string; started_at?: string; finished_at?: string }
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [scheduleRuns, setScheduleRuns] = useState<{ id: string; runs: ScheduleRun[] } | null>(null);

  const loadSchedules = async () => {
    try {
      const d = await apiGet<{ schedules: ScheduleItem[] }>('/api/fusion/team/schedules');
      setSchedules(d.schedules ?? []);
    } catch (err) {
      setScheduleMsg(`加载定时任务失败：${err instanceof Error ? err.message : err}`);
    }
  };

  const scheduleAction = async (id: string, action: 'pause' | 'resume' | 'trigger' | 'delete') => {
    if (action === 'delete' && !window.confirm('确认删除该定时巡检任务？')) return;
    try {
      if (action === 'delete') {
        await apiDelete(`/api/fusion/team/schedules/${id}`);
      } else {
        await apiPost(`/api/fusion/team/schedules/${id}/${action}`);
      }
      await loadSchedules();
    } catch (err) {
      setScheduleMsg(`${action} 失败：${err instanceof Error ? err.message : err}`);
    }
  };

  const loadScheduleRuns = async (id: string) => {
    if (scheduleRuns?.id === id) { setScheduleRuns(null); return; }
    try {
      const d = await apiGet<{ runs: ScheduleRun[] }>(`/api/fusion/team/schedules/${id}/runs`);
      setScheduleRuns({ id, runs: d.runs ?? [] });
    } catch (err) {
      setScheduleMsg(`加载执行历史失败：${err instanceof Error ? err.message : err}`);
    }
  };

  // 模板版本查看 / 回填（P5）
  const [versions, setVersions] = useState<{ version: number; updated_at?: number; description?: string }[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [versionMsg, setVersionMsg] = useState('');

  const refreshTemplates = async () => {
    const d = await apiGet<{ templates: TeamTemplate[] }>('/api/fusion/team/templates');
    setTemplates(d.templates ?? []);
  };

  const loadVersions = async () => {
    if (!template) { setVersionMsg('请先选择团队模板'); return; }
    try {
      const d = await apiGet<{ current: any; history: any[] }>(
        `/api/fusion/team/templates/${template}/versions`,
      );
      setVersions([d.current, ...(d.history ?? []).slice().reverse()]);
      setShowVersions(true);
      setVersionMsg('');
    } catch (err) {
      setVersionMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const rollbackVersion = async (v: number) => {
    if (!window.confirm(`确认回填到版本 v${v}？当前内容会归档，回填后成为新版本。`)) return;
    try {
      const r = await apiPost<{ version: number }>(`/api/fusion/team/templates/${template}/rollback`, {
        version: v,
      });
      setVersionMsg(`已回填到 v${v}（新版本 v${r.version}）`);
      await loadVersions();
      await refreshTemplates();
    } catch (err) {
      setVersionMsg(`回填失败：${err instanceof Error ? err.message : err}`);
    }
  };

  // 模板市场（P5 余项）：内置模板一键导入为自定义副本
  interface MarketItem {
    name: string; icon: string; description: string;
    members: string[] | null; soul: string;
    workflows: { id: string; label: string; task: string }[];
    installed: boolean;
  }
  const [market, setMarket] = useState<MarketItem[]>([]);
  const [showMarket, setShowMarket] = useState(false);
  const [marketMsg, setMarketMsg] = useState('');

  const loadMarket = async () => {
    try {
      const d = await apiGet<{ market: MarketItem[] }>('/api/fusion/team/templates/market');
      setMarket(d.market ?? []);
      setShowMarket(true);
    } catch (err) {
      setMarketMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const installFromMarket = async (item: MarketItem) => {
    const copyName = window.prompt(
      `以副本名称导入「${item.name}」（仅字母/数字/下划线/连字符）：`,
      `${item.name}-copy`,
    );
    if (!copyName) return;
    try {
      await apiPost('/api/fusion/team/templates/import', {
        name: copyName,
        icon: item.icon,
        description: item.description,
        members: item.members,
        soul: item.soul,
        workflows: item.workflows,
        source: `market:${item.name}`,
      });
      setMarketMsg(`已导入副本 ${copyName}`);
      await loadMarket();
      await refreshTemplates();
    } catch (err) {
      setMarketMsg(`导入失败：${err instanceof Error ? err.message : err}`);
    }
  };

  useEffect(() => {
    apiGet<{ agents: AgentItem[] }>('/api/agents')
      .then(d => {
        const seen = new Set<string>();
        const unique = d.agents.filter(a => {
          if (seen.has(a.agentId)) return false;
          seen.add(a.agentId);
          return true;
        });
        setAgents(unique);
        setSelected(new Set(unique.map(a => a.agentId)));
      })
      .catch(console.error);
    apiGet<{ templates: TeamTemplate[] }>('/api/fusion/team/templates')
      .then(d => setTemplates(d.templates ?? []))
      .catch(console.error);
  }, []);

  // 结果自动滚到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [result, loading]);

  const activeTemplate = useMemo(
    () => templates.find(t => t.name === template) ?? null,
    [templates, template],
  );

  /** 切换团队：联动成员班底（不同团队 = 不同编排人设 + 不同成员） */
  const handleSelectTemplate = (name: string) => {
    setTemplate(name);
    setWorkflow('');
    if (!name) {
      // 自定义团队：恢复全选
      setSelected(new Set(agents.map(a => a.agentId)));
      return;
    }
    const spec = templates.find(t => t.name === name);
    if (spec?.members) {
      setSelected(new Set(spec.members.filter(m => agents.some(a => a.agentId === m))));
    } else {
      setSelected(new Set(agents.map(a => a.agentId)));
    }
  };

  /** 选择工作流：任务框填充预设（可编辑） */
  const handleSelectWorkflow = (wfId: string) => {
    setWorkflow(wfId);
    const wf = activeTemplate?.workflows.find(w => w.id === wfId);
    if (wf) setTask(wf.task);
  };

  const toggleAgent = (agentId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const handleRun = async () => {
    if (!task.trim() || loading || selected.size === 0) return;
    setLoading(true);
    setError('');
    setResult(null);
    setMemberStatus({});
    try {
      // 非阻塞启动：team/start 立即返回 thread_id，轮询 /team/status 实时展示成员进度
      const start = await apiPost<{ thread_id: string }>('/api/fusion/team/start', {
        task: task.trim(),
        agent_ids: Array.from(selected),
        template: template || undefined,
        workflow: workflow || undefined,
      });
      const threadId = start.thread_id;
      let attempts = 0;
      const poll = async () => {
        if (attempts++ > 200) { // 200 × 3s ≈ 10 分钟
          setLoading(false);
          setError('团队任务超时');
          return;
        }
        try {
          const d = await apiGet<{
            thread_id: string; status: string; terminal: boolean;
            members: MemberStatus[]; reply?: string; delegations?: { tool: string; result: string }[];
          }>(`/api/fusion/team/status/${threadId}`);
          if (d.members?.length) {
            setMemberStatus(Object.fromEntries(d.members.map(m => [m.agent_id, m])));
          }
          if (!d.terminal) {
            pollRef.current = window.setTimeout(poll, 3000);
            return;
          }
          setLoading(false);
          setResult({
            reply: d.reply || '（团队任务已结束）',
            status: d.status,
            team: Array.from(selected),
            delegations: d.delegations ?? [],
            thread_id: threadId,
          });
        } catch (err) {
          setLoading(false);
          setError(`进度查询失败：${err instanceof Error ? err.message : err}`);
        }
      };
      poll();
    } catch (err) {
      setLoading(false);
      setError(`编排失败：${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold dark:text-gray-100">🧭 多 Agent 团队编排</h2>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">主代理（DeerFlow）分派 → penguin Agent 子代理</span>
      </div>

      {/* 团队模板：不同团队 = 不同编排人设 + 不同成员班底 */}
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">🏢 选择团队</p>
        <div className="flex items-center gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            📥 导入模板
          </button>
          <button
            onClick={handleExport}
            disabled={!template}
            className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            📤 导出
          </button>
          <button
            onClick={loadVersions}
            disabled={!template}
            className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            🕓 版本
          </button>
          <button
            onClick={loadMarket}
            className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            🛒 市场
          </button>
          {assetMsg && (
            <span className="text-[11px] text-blue-500 dark:text-blue-300">{assetMsg}</span>
          )}
        </div>
      </div>
      {showVersions && (
        <div className="mb-3 space-y-1 rounded border border-gray-200 p-2 dark:border-gray-600">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">版本历史（{versions.length}）</span>
            <button onClick={() => setShowVersions(false)} className="text-[11px] text-gray-400 hover:text-gray-600">收起</button>
          </div>
          {versions.map((v, i) => (
            <div key={`${v.version}-${i}`} className="flex items-center gap-2 text-[11px]">
              <span className="font-mono text-gray-600 dark:text-gray-300">v{v.version}</span>
              <span className="flex-1 truncate text-gray-400 dark:text-gray-500">{v.description || '-'}</span>
              {i > 0 && (
                <button
                  onClick={() => rollbackVersion(v.version)}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  回填
                </button>
              )}
              {i === 0 && <span className="text-green-500">当前</span>}
            </div>
          ))}
          {versionMsg && <p className="text-[11px] text-blue-500 dark:text-blue-300">{versionMsg}</p>}
        </div>
      )}
      {showMarket && (
        <div className="mb-3 space-y-1 rounded border border-gray-200 p-2 dark:border-gray-600">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">模板市场（内置模板一键导入为副本）</span>
            <button onClick={() => setShowMarket(false)} className="text-[11px] text-gray-400 hover:text-gray-600">收起</button>
          </div>
          {market.map(item => (
            <div key={item.name} className="flex items-center gap-2 text-[11px]">
              <span>{item.icon}</span>
              <span className="flex-1 truncate text-gray-600 dark:text-gray-300" title={item.description}>
                {item.description.split('：')[0] || item.name}
              </span>
              {item.installed && <span className="text-green-500">已有副本</span>}
              <button
                onClick={() => installFromMarket(item)}
                className="rounded border border-gray-300 px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                导入副本
              </button>
            </div>
          ))}
          {marketMsg && <p className="text-[11px] text-blue-500 dark:text-blue-300">{marketMsg}</p>}
        </div>
      )}
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        <button
          onClick={() => handleSelectTemplate('')}
          className={`rounded-lg border p-2 text-left transition ${
            template === ''
              ? 'border-purple-400 bg-purple-50 dark:border-purple-500 dark:bg-purple-900/30'
              : 'border-gray-200 hover:border-purple-300 dark:border-gray-600'
          }`}
        >
          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">🛠️ 自定义团队</p>
          <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">手动勾选成员，默认主代理</p>
        </button>
        {templates.map(tpl => (
          <button
            key={tpl.name}
            onClick={() => handleSelectTemplate(tpl.name)}
            className={`rounded-lg border p-2 text-left transition ${
              template === tpl.name
                ? 'border-purple-400 bg-purple-50 dark:border-purple-500 dark:bg-purple-900/30'
                : 'border-gray-200 hover:border-purple-300 dark:border-gray-600'
            }`}
          >
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
              {tpl.icon} {tpl.description.split('：')[0]}
            </p>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-400 dark:text-gray-500">{tpl.description}</p>
            <p className="mt-0.5 text-[11px] text-purple-500">
              {tpl.members ? `${tpl.members.length} 名成员` : '全部成员'} · {tpl.workflows.length} 个工作流
            </p>
          </button>
        ))}
      </div>

      {/* 工作流：同团队不同工作流程预设 */}
      {activeTemplate && activeTemplate.workflows.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">⚙️ 工作流（同团队不同流程）</p>
          <div className="flex flex-wrap gap-1.5">
            {activeTemplate.workflows.map(wf => (
              <button
                key={wf.id}
                onClick={() => handleSelectWorkflow(wf.id)}
                className={`rounded-full px-2.5 py-1 text-xs transition ${
                  workflow === wf.id
                    ? 'bg-purple-100 font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400'
                }`}
              >
                {workflow === wf.id ? '✓ ' : ''}{wf.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 定时巡检：用当前团队 + 工作流创建 DeerFlow 定时任务（P4） */}
      {activeTemplate && (
        <div className="mb-3">
          <button
            onClick={() => setShowSchedule(v => !v)}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            ⏰ 定时巡检（{showSchedule ? '收起' : '设置'})
          </button>
          {showSchedule && (
            <div className="mt-2 space-y-1.5 rounded border border-gray-200 p-2 dark:border-gray-600">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-500 dark:text-gray-400">Cron</span>
                <input
                  value={scheduleCron}
                  onChange={e => setScheduleCron(e.target.value)}
                  placeholder="0 9 * * *"
                  className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 font-mono text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
                <span className="text-[11px] text-gray-500 dark:text-gray-400">时区</span>
                <input
                  value={scheduleTz}
                  onChange={e => setScheduleTz(e.target.value)}
                  className="w-28 rounded border border-gray-300 px-1.5 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
                <button
                  onClick={handleSchedule}
                  className="rounded bg-purple-500 px-2 py-0.5 text-xs text-white hover:bg-purple-600"
                >
                  创建
                </button>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                绑定时使用 {activeTemplate.icon} {activeTemplate.description.split('：')[0]} 主代理
                {workflow ? '（含所选工作流任务）' : '（未选工作流，用当前任务框内容）'}
              </p>
              {scheduleMsg && <p className="text-[11px] text-blue-500 dark:text-blue-300">{scheduleMsg}</p>}

              {/* 定时任务列表 + 执行历史（P6） */}
              <div className="border-t border-gray-100 pt-1.5 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    已有定时任务（{schedules.length}）
                  </span>
                  <button
                    onClick={loadSchedules}
                    className="text-[11px] text-purple-500 hover:underline"
                  >
                    刷新
                  </button>
                </div>
                {schedules.map(s => (
                  <div key={s.id} className="mt-1 rounded bg-gray-50 p-1.5 dark:bg-gray-700/50">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className={`rounded px-1 ${
                        s.status === 'paused'
                          ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-300'
                          : 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400'
                      }`}>{s.status || 'active'}</span>
                      <span className="flex-1 truncate text-gray-600 dark:text-gray-300">{s.title || s.id}</span>
                      <button onClick={() => scheduleAction(s.id, 'trigger')} className="text-purple-500 hover:underline">立即跑</button>
                      <button
                        onClick={() => scheduleAction(s.id, s.status === 'paused' ? 'resume' : 'pause')}
                        className="text-purple-500 hover:underline"
                      >
                        {s.status === 'paused' ? '恢复' : '暂停'}
                      </button>
                      <button onClick={() => scheduleAction(s.id, 'delete')} className="text-red-400 hover:underline">删除</button>
                      <button onClick={() => loadScheduleRuns(s.id)} className="text-purple-500 hover:underline">
                        {scheduleRuns?.id === s.id ? '收起历史' : '历史'}
                      </button>
                    </div>
                    {scheduleRuns?.id === s.id && (
                      <div className="mt-1 space-y-0.5 border-t border-gray-200 pt-1 dark:border-gray-600">
                        {scheduleRuns.runs.length === 0 && (
                          <p className="text-[11px] text-gray-400">暂无执行记录</p>
                        )}
                        {scheduleRuns.runs.map((r, i) => (
                          <p key={r.id || r.run_id || i} className="text-[11px] text-gray-500 dark:text-gray-400">
                            #{i + 1} {r.status || 'unknown'}{r.started_at ? ` · ${new Date(r.started_at).toLocaleString()}` : ''}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {schedules.length === 0 && (
                  <p className="mt-1 text-[11px] text-gray-400">点「刷新」加载定时任务列表</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 团队成员选择 */}
      <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
        👥 团队成员（{selected.size} 名，可微调）
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {agents.map(a => (
          <button
            key={`${a.project_id}/${a.agentId}`}
            onClick={() => toggleAgent(a.agentId)}
            className={`rounded-full px-2.5 py-1 text-xs transition ${
              selected.has(a.agentId)
                ? 'bg-purple-100 text-purple-700 font-medium dark:bg-purple-900/40 dark:text-purple-300'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            {selected.has(a.agentId) ? '✓ ' : ''}{a.name}（{a.agentId}）
          </button>
        ))}
        {agents.length === 0 && <p className="text-xs text-gray-400">暂无 Agent</p>}
      </div>

      {/* 任务输入 + 运行 */}
      <div className="mb-2 flex gap-2">
        <input
          value={task}
          onChange={e => setTask(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && handleRun()}
          placeholder={
            activeTemplate
              ? `选择工作流自动填充，或直接下达团队任务（${activeTemplate.description.split('：')[0]} 将拆解分派）`
              : '下达团队任务（主代理会搜索、拆解并分派给成员）'
          }
          disabled={loading}
          className="flex-1 rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 disabled:opacity-50"
        />
        <button
          onClick={handleRun}
          disabled={loading || !task.trim() || selected.size === 0}
          className="rounded bg-purple-500 px-4 py-2 text-sm text-white hover:bg-purple-600 disabled:opacity-50"
        >
          {loading ? '编排中…' : '🚀 编排'}
        </button>
      </div>

      {/* 结果区：大屏展示编排过程与最终汇总（原 max-h-80 放大到 30rem） */}
      <div ref={scrollRef} className="mt-3 max-h-[30rem] space-y-2 overflow-y-auto">
        {loading && (
          <div className="rounded bg-purple-50 p-3 text-sm text-purple-600 dark:bg-purple-900/30 dark:text-purple-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:0.3s]" />
              {activeTemplate
                ? `${activeTemplate.icon} ${activeTemplate.description.split('：')[0]} 正在拆解并分派任务给 ${selected.size} 个成员…`
                : `主代理正在搜索、拆解并分派任务给 ${selected.size} 个成员…`}
            </span>
          </div>
        )}

        {/* 实时成员状态（非阻塞轮询）：工作中转圈 / 完成 / 失败 */}
        {loading && Object.keys(memberStatus).length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {Object.entries(memberStatus).map(([aid, ms]) => {
              const name = agents.find(a => a.agentId === aid)?.name ?? aid;
              const cls = ms.state === 'working'
                ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300'
                : ms.state === 'done'
                  ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                  : ms.state === 'failed'
                    ? 'bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
              return (
                <span key={aid} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${cls}`}>
                  {ms.state === 'working'
                    ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
                    : ms.state === 'done' ? '✅' : ms.state === 'failed' ? '❌' : '⏳'}
                  {name}
                </span>
              );
            })}
          </div>
        )}

        {result && (
          <>
            {/* 编排过程：子代理分派记录 */}
            {result.delegations.length > 0 && (
              <div className="rounded border border-purple-100 bg-purple-50/50 p-3 dark:border-purple-800 dark:bg-purple-900/20">
                <p className="mb-2 text-xs font-medium text-purple-600 dark:text-purple-300">
                  🤝 子代理分派（{result.delegations.length} 次）
                </p>
                <div className="space-y-1.5">
                  {result.delegations.map((d, i) => (
                    <div key={i} className="rounded bg-white p-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      <span className="font-mono text-purple-500 dark:text-purple-400">task #{i + 1}</span>{' '}
                      <span className="whitespace-pre-wrap">{d.result.slice(0, 400)}</span>
                      {d.result.length > 400 && <span>…</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 最终回复 */}
            <div className="rounded bg-gray-50 p-3 dark:bg-gray-700/50">
              <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                📋 主代理汇总（团队成员：{result.team.join(' / ')}）
              </p>
              <Markdown content={result.reply} />
            </div>

            {/* 通信流可视化：本次 run 的 orchestrator→成员 分派图 */}
            {result.thread_id && <FlowGraph threadId={result.thread_id} />}
          </>
        )}
        {error && <p className="text-center text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}
