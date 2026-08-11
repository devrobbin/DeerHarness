'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { Badge, Button, Card } from '@/components/ui';

interface SystemInfo {
  version: string;
  env: {
    penguin_api: string;
    penguin_user: string;
    deerflow_api: string;
    deerflow_config: string;
    deepseek_key_set: boolean;
    admin_key_set: boolean;
    max_cost_per_request: number;
    cors_origins: string[];
  };
  health: Record<string, { status: string; url?: string; version?: string }>;
}

const STATUS_LABELS: Record<string, { text: string; color: 'green' | 'red' | 'amber' }> = {
  up: { text: '正常', color: 'green' },
  down: { text: '离线', color: 'red' },
  degraded: { text: '异常', color: 'amber' },
};

/** 系统信息：移植 DeerFlow about-settings + PenguinHarness 状态面板 */
export function SystemSettings() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchInfo = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<SystemInfo>('/api/settings/system');
      setInfo(data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold dark:text-gray-100">系统信息</h2>
        <Button variant="ghost" onClick={fetchInfo} disabled={loading}>
          {loading ? '检测中…' : '刷新'}
        </Button>
      </div>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</p>}

      {info && (
        <>
          <Card>
            <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-200">服务健康</h3>
            <div className="space-y-2">
              {Object.entries(info.health).map(([name, h]) => {
                const s = STATUS_LABELS[h.status] || STATUS_LABELS.degraded;
                return (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium text-gray-800 dark:text-gray-100">{name}</span>
                      {h.url && <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{h.url}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {h.version && <span className="text-xs text-gray-400">v{h.version}</span>}
                      <Badge color={s.color}>{s.text}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-200">环境配置</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-gray-500 dark:text-gray-400">版本</dt>
                <dd className="font-mono text-gray-800 dark:text-gray-100">{info.version}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-gray-500 dark:text-gray-400">PenguinHarness</dt>
                <dd className="truncate font-mono text-xs text-gray-800 dark:text-gray-100">{info.env.penguin_api}（{info.env.penguin_user}）</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-gray-500 dark:text-gray-400">DeerFlow</dt>
                <dd className="truncate font-mono text-xs text-gray-800 dark:text-gray-100">{info.env.deerflow_api}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-gray-500 dark:text-gray-400">DeerFlow 配置</dt>
                <dd className="truncate font-mono text-xs text-gray-800 dark:text-gray-100">{info.env.deerflow_config}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-gray-500 dark:text-gray-400">单请求预算</dt>
                <dd className="text-gray-800 dark:text-gray-100">${info.env.max_cost_per_request}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-gray-500 dark:text-gray-400">CORS 白名单</dt>
                <dd className="truncate font-mono text-xs text-gray-800 dark:text-gray-100">{info.env.cors_origins.join(', ') || '(默认 localhost:3000)'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-gray-500 dark:text-gray-400">DeepSeek 评测 Key</dt>
                <dd>{info.env.deepseek_key_set ? <Badge color="green">已配置</Badge> : <Badge color="amber">未配置</Badge>}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-gray-500 dark:text-gray-400">管理员初始 Key</dt>
                <dd>{info.env.admin_key_set ? <Badge color="green">已配置</Badge> : <Badge color="amber">未配置</Badge>}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">密钥与密码仅显示"是否已配置"，不暴露原文</p>
          </Card>
        </>
      )}
    </div>
  );
}
