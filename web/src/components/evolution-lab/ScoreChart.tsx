'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';

interface Props {
  taskId: string;
}

interface Version {
  version: string;
  score?: number | null;
  change_summary?: string;
}

export function ScoreChart({ taskId }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) {
      setVersions([]);
      return;
    }
    apiGet<{ versions?: Version[] }>(`/api/evolution/tasks/${taskId}/versions`)
      .then(data => setVersions(data.versions ?? []))
      .catch(() => setVersions([]));
  }, [taskId]);

  const rollback = async (version: string) => {
    if (!window.confirm(`确认回滚到版本 v${version}？将恢复该版本之前的配置，当前覆盖会被替换或删除。`)) {
      return;
    }
    setRollingBack(version);
    setMsg(null);
    try {
      const res = await apiPost<{ success: boolean; summary?: string }>(
        `/api/evolution/tasks/${taskId}/rollback`,
        { version: Number(version) },
      );
      setMsg(res.summary ?? '回滚成功');
      // 刷新版本列表（回滚会追加一条新版本记录）
      const data = await apiGet<{ versions?: Version[] }>(`/api/evolution/tasks/${taskId}/versions`);
      setVersions(data.versions ?? []);
    } catch (e: any) {
      setMsg(`回滚失败：${e?.message ?? '未知错误'}`);
    } finally {
      setRollingBack(null);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 font-semibold">📈 版本得分对比</h2>
      {msg && <p className="mb-2 text-sm text-blue-600 dark:text-blue-300">{msg}</p>}
      {taskId ? (
        versions.length > 0 ? (
          <div className="space-y-2">
            {versions.map(v => (
              <div key={v.version} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 font-mono text-xs">{v.version}</span>
                <div className="h-6 flex-1 rounded bg-gray-100 dark:bg-gray-700">
                  <div
                    className="flex h-6 items-center rounded bg-gradient-to-r from-purple-400 to-blue-500 px-2 text-xs text-white"
                    style={{ width: `${Math.min(100, Math.max(4, (v.score ?? 0) * 1.2))}%` }}
                    title={v.change_summary}
                  >
                    {v.score ?? '-'}
                  </div>
                </div>
                <button
                  onClick={() => rollback(v.version)}
                  disabled={rollingBack !== null}
                  className="shrink-0 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  {rollingBack === v.version ? '回滚中…' : '回滚'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">暂无版本数据</p>
        )
      ) : (
        <p className="text-sm text-gray-400">请先启动进化任务</p>
      )}
    </div>
  );
}
