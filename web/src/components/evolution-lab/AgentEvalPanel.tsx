'use client';

import React, { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { Button, Card, Input, Spinner } from '@/components/ui';

interface AgentItem {
  agentId: string;
  name: string;
  project_id: string;
}

interface EvalCase {
  id: string;
  title: string;
  score: number;
  comment: string;
  reply: string;
}

interface EvalReport {
  agent_id: string;
  deerflow_agent: string;
  benchmark_id: string;
  version_baseline: string;
  average_score: number;
  cases: EvalCase[];
}

/**
 * 进化评测面板：选 Agent → DeerFlow 运行时执行 benchmark cases → LLM 评分。
 */
export function AgentEvalPanel() {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [selected, setSelected] = useState('');
  const [benchmark, setBenchmark] = useState('example-benchmark');
  const [maxCases, setMaxCases] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<EvalReport | null>(null);

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
        if (unique.length > 0) setSelected(unique[0].agentId);
      })
      .catch(console.error);
  }, []);

  const agent = agents.find(a => a.agentId === selected);

  const handleRun = async () => {
    if (!agent || loading) return;
    setLoading(true);
    setError('');
    setReport(null);
    try {
      const data = await apiPost<EvalReport>('/api/fusion/evaluate', {
        agent_id: agent.agentId,
        project_id: agent.project_id,
        benchmark_id: benchmark.trim() || 'example-benchmark',
        max_cases: Math.max(1, Math.min(10, maxCases)),
      });
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">🎯 Agent 进化评测</h2>
        <span className="text-[11px] text-gray-400">DeerFlow 执行 → LLM 评分（0-100）</span>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          aria-label="选择评测 Agent"
          className="rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        >
          {agents.map(a => (
            <option key={`${a.project_id}/${a.agentId}`} value={a.agentId}>
              {a.name}（{a.agentId}）
            </option>
          ))}
        </select>
        <Input
          value={benchmark}
          onChange={e => setBenchmark(e.target.value)}
          placeholder="Benchmark ID"
          aria-label="Benchmark ID"
        />
        <Input
          type="number"
          min={1}
          max={10}
          value={maxCases}
          onChange={e => setMaxCases(Number(e.target.value))}
          aria-label="评测用例数"
        />
      </div>

      <Button variant="purple" onClick={handleRun} disabled={loading || !agent} className="w-full">
        {loading ? '评测中（逐 case 执行 + LLM 评分）…' : '🚀 运行评测'}
      </Button>
      {loading && <div className="mt-2"><Spinner label="正在执行 benchmark…" /></div>}
      {error && <p role="alert" className="mt-2 text-sm text-red-500">{error}</p>}

      {report && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between rounded bg-gray-50 p-3 dark:bg-gray-700">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {report.agent_id} · {report.benchmark_id}
              </p>
              <p className="text-xs text-gray-400">
                dh-{report.deerflow_agent} · 版本 {report.version_baseline || '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {report.average_score}
              </p>
              <p className="text-xs text-gray-400">平均分</p>
            </div>
          </div>

          <div className="space-y-2">
            {report.cases.map(c => (
              <div key={c.id} className="rounded border border-gray-100 p-2.5 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                    {c.id} · {c.title}
                  </span>
                  <span className={`text-sm font-bold ${c.score >= 60 ? 'text-green-600' : c.score >= 30 ? 'text-amber-600' : 'text-red-500'}`}>
                    {c.score} 分
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full rounded bg-gray-100 dark:bg-gray-700">
                  <div
                    className="h-1.5 rounded bg-gradient-to-r from-purple-400 to-blue-500"
                    style={{ width: `${c.score}%` }}
                  />
                </div>
                {c.comment && <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{c.comment}</p>}
                {c.reply && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-gray-400">查看 Agent 回复</summary>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-gray-500 dark:text-gray-400">{c.reply}</p>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
