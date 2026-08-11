'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { Markdown } from '@/components/Markdown';

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
}

interface TeamResult {
  reply: string;
  status: string;
  team: string[];
  delegations: { tool: string; result: string }[];
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
  const [error, setError] = useState('');
  const [result, setResult] = useState<TeamResult | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    try {
      const data = await apiPost<TeamResult>('/api/fusion/team/run', {
        task: task.trim(),
        agent_ids: Array.from(selected),
        template: template || undefined,
        workflow: workflow || undefined,
      });
      setResult(data);
    } catch (err) {
      setError(`编排失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold dark:text-gray-100">🧭 多 Agent 团队编排</h2>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">主代理（DeerFlow）分派 → penguin Agent 子代理</span>
      </div>

      {/* 团队模板：不同团队 = 不同编排人设 + 不同成员班底 */}
      <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">🏢 选择团队</p>
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
          onKeyDown={e => e.key === 'Enter' && handleRun()}
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
          </>
        )}
        {error && <p className="text-center text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}
