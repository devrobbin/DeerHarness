'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { Card } from '@/components/ui';

interface EvalTrace {
  trace_id: string;
  agent_id: string;
  score?: number | null;
  task_goal?: string;
  received_at?: number;
}

/**
 * 评测历史：从 traces 拉取 eval:* 记录，展示分数趋势（进化效果的度量）。
 */
export function EvalHistory() {
  const [records, setRecords] = useState<EvalTrace[]>([]);

  useEffect(() => {
    apiGet<{ traces: EvalTrace[] }>('/api/traces?limit=100')
      .then(d => setRecords(d.traces.filter(t => t.agent_id.startsWith('eval:'))))
      .catch(() => setRecords([]));
  }, []);

  if (records.length === 0) {
    return (
      <Card>
        <h2 className="mb-2 font-semibold">📈 评测历史</h2>
        <p className="text-sm text-gray-400">暂无评测记录 — 运行一次「Agent 进化评测」后这里会出现分数趋势</p>
      </Card>
    );
  }

  // 按 agent 分组，时间升序
  const byAgent = new Map<string, EvalTrace[]>();
  for (const r of [...records].reverse()) {
    const key = r.agent_id.replace('eval:', '');
    byAgent.set(key, [...(byAgent.get(key) ?? []), r]);
  }
  const groups: Array<[string, EvalTrace[]]> = Array.from(byAgent.entries());

  return (
    <Card>
      <h2 className="mb-3 font-semibold">📈 评测历史（分数趋势）</h2>
      <div className="space-y-4">
        {groups.map(([agentId, list]) => {
          const latest = list[list.length - 1];
          const prev = list.length > 1 ? list[list.length - 2] : null;
          const delta = prev?.score != null && latest?.score != null ? latest.score - prev.score : null;
          return (
            <div key={agentId}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  🧬 {agentId}
                </span>
                {delta !== null && (
                  <span className={`text-xs ${delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} 分
                  </span>
                )}
              </div>
              <div className="flex h-6 items-end gap-1">
                {list.map((r, i) => (
                  <div key={r.trace_id} className="flex flex-col items-center" title={`${r.score ?? 0} 分`}>
                    <div
                      className={`w-5 rounded-t ${(r.score ?? 0) >= 60 ? 'bg-green-400' : (r.score ?? 0) >= 30 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ height: `${Math.max(4, (r.score ?? 0)) * 0.4}px` }}
                    />
                    <span className="text-[9px] text-gray-400">#{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
