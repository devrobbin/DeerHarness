'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { ApiKeyInput } from '@/components/ApiKeyInput';
import { Badge, Button, Card } from '@/components/ui';

interface Me {
  id: string;
  username: string;
  role: string;
  created_at: number;
}

const ROLE_LABELS: Record<string, string> = { admin: '管理员', developer: '开发者', viewer: '只读' };

/** 账户设置：移植 DeerFlow account-settings（账户信息 + 修改密码 → 网关为 API Key 轮换） */
export function AccountSettings() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [rotating, setRotating] = useState(false);
  const [newKey, setNewKey] = useState('');

  useEffect(() => {
    apiGet<{ user: Me }>('/api/users/me')
      .then(d => setMe(d.user))
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const handleRotate = async () => {
    if (!window.confirm('轮换后旧 API Key 立即失效，请立即保存新密钥。确定继续？')) return;
    setRotating(true);
    setError('');
    try {
      const res = await apiPost<{ api_key: string }>('/api/users/me/rotate-key');
      setNewKey(res.api_key);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRotating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(newKey).catch(() => {});
  };

  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-lg font-semibold dark:text-gray-100">账户设置</h2>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</p>}

      {me && (
        <Card>
          <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-200">账户信息</h3>
          <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
            <div className="flex items-center gap-2">
              <span className="w-20 text-gray-500 dark:text-gray-400">用户名</span>
              <span className="font-medium text-gray-800 dark:text-gray-100">{me.username}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 text-gray-500 dark:text-gray-400">角色</span>
              <Badge color={me.role === 'admin' ? 'purple' : me.role === 'developer' ? 'green' : 'gray'}>
                {ROLE_LABELS[me.role] || me.role}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 text-gray-500 dark:text-gray-400">用户 ID</span>
              <span className="font-mono text-xs">{me.id}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 text-gray-500 dark:text-gray-400">创建时间</span>
              <span>{new Date(me.created_at * 1000).toLocaleString()}</span>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">Gateway API Key</h3>
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">所有页面请求通过该密钥鉴权，仅存于本机浏览器</p>
        <ApiKeyInput />
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">轮换 API Key</h3>
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">旧密钥立即失效。新密钥仅显示一次，请妥善保存（对应修改密码）</p>
        <Button variant="danger" onClick={handleRotate} disabled={rotating}>
          {rotating ? '轮换中…' : '轮换密钥'}
        </Button>
        {newKey && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/30">
            <p className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-400">⚠️ 新 API Key（仅显示一次）</p>
            <code className="block break-all rounded bg-white px-2 py-1.5 font-mono text-xs dark:bg-gray-800">{newKey}</code>
            <button onClick={handleCopy} className="mt-2 text-xs text-amber-700 underline dark:text-amber-400">复制</button>
          </div>
        )}
      </Card>
    </div>
  );
}
