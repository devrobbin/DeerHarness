'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

interface Props {
  taskId: string;
}

interface Version {
  version: string;
  score?: number | null;
}

export function ScoreChart({ taskId }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);

  useEffect(() => {
    if (!taskId) {
      setVersions([]);
      return;
    }
    apiGet<{ versions?: Version[] }>(`/api/evolution/tasks/${taskId}/versions`)
      .then(data => setVersions(data.versions ?? []))
      .catch(() => setVersions([]));
  }, [taskId]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 font-semibold">📈 版本得分对比</h2>
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
                  >
                    {v.score ?? '-'}
                  </div>
                </div>
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
