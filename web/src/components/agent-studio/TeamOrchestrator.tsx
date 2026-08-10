'use client';

import React, { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { Markdown } from '@/components/Markdown';

interface AgentItem {
  agentId: string;
  name: string;
  project_id: string;
}

interface TeamResult {
  reply: string;
  status: string;
  team: string[];
  delegations: { tool: string; result: string }[];
}

/**
 * 多 Agent 编排（团队模式）：主代理（DeerFlow）把子任务分派给
 * 团队成员（PenguinHarness Agent 子代理）。
 */
export function TeamOrchestrator() {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
  }, []);

  // 结果自动滚到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [result, loading]);

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
      });
      setResult(data);
    } catch (err) {
      setError(`编排失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">🧭 多 Agent 团队编排</h2>
        <span className="text-[11px] text-gray-400">主代理（DeerFlow）分派 → penguin Agent 子代理</span>
      </div>

      {/* 团队成员选择 */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {agents.map(a => (
          <button
            key={`${a.project_id}/${a.agentId}`}
            onClick={() => toggleAgent(a.agentId)}
            className={`rounded-full px-2.5 py-1 text-xs transition ${
              selected.has(a.agentId)
                ? 'bg-purple-100 text-purple-700 font-medium'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {selected.has(a.agentId) ? '✓ ' : ''}{a.name}（{a.agentId}）
          </button>
        ))}
        {agents.length === 0 && <p className="text-xs text-gray-400">暂无 Agent</p>}
      </div>

      {/* 任务输入 */}
      <div className="flex gap-2">
        <input
          value={task}
          onChange={e => setTask(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleRun()}
          placeholder="下达团队任务（主代理会搜索、拆解并分派给成员）"
          disabled={loading}
          className="flex-1 rounded border border-gray-300 p-2 text-sm disabled:opacity-50"
        />
        <button
          onClick={handleRun}
          disabled={loading || !task.trim() || selected.size === 0}
          className="rounded bg-purple-500 px-4 py-2 text-sm text-white hover:bg-purple-600 disabled:opacity-50"
        >
          {loading ? '编排中…' : '🚀 编排'}
        </button>
      </div>

      {/* 结果区 */}
      <div ref={scrollRef} className="mt-3 max-h-80 space-y-2 overflow-y-auto">
        {loading && (
          <div className="rounded bg-purple-50 p-3 text-sm text-purple-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:0.3s]" />
              主代理正在搜索、拆解并分派任务给 {selected.size} 个成员…
            </span>
          </div>
        )}

        {result && (
          <>
            {/* 编排过程：子代理分派记录 */}
            {result.delegations.length > 0 && (
              <div className="rounded border border-purple-100 bg-purple-50/50 p-3">
                <p className="mb-2 text-xs font-medium text-purple-600">
                  🤝 子代理分派（{result.delegations.length} 次）
                </p>
                <div className="space-y-1.5">
                  {result.delegations.map((d, i) => (
                    <div key={i} className="rounded bg-white p-2 text-xs text-gray-600">
                      <span className="font-mono text-purple-500">task #{i + 1}</span>{' '}
                      <span className="whitespace-pre-wrap">{d.result.slice(0, 220)}</span>
                      {d.result.length > 220 && <span>…</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 最终回复 */}
            <div className="rounded bg-gray-50 p-3">
              <p className="mb-1.5 text-xs font-medium text-gray-500">
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
