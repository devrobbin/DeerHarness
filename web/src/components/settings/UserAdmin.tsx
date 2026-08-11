'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, Input, tokens } from '@/components/ui';

interface UserRow {
  id: string;
  username: string;
  role: string;
  created_at: number;
}

const ROLE_LABELS: Record<string, string> = { admin: '管理员', developer: '开发者', viewer: '只读' };

/** 用户管理（管理员）：移植 PenguinHarness admin-users-page 的用户表 + 创建 / 重置 / 删除 */
export function UserAdmin() {
  const { t } = useI18n();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [createForm, setCreateForm] = useState({ username: '', api_key: '', role: 'developer' });
  const [showCreate, setShowCreate] = useState(false);
  const [rotatedKey, setRotatedKey] = useState<{ username: string; key: string } | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await apiGet<{ users: UserRow[] }>('/api/users');
      setUsers(data.users);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    apiGet<{ user: UserRow }>('/api/users/me')
      .then(d => { setIsAdmin(d.user.role === 'admin'); if (d.user.role === 'admin') fetchUsers(); })
      .catch(e => { setIsAdmin(false); setError(e instanceof Error ? e.message : String(e)); });
  }, [fetchUsers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.username.trim() || !createForm.api_key.trim()) {
      setError('用户名和 API Key 必填');
      return;
    }
    try {
      await apiPost('/api/users', createForm);
      setShowCreate(false);
      setCreateForm({ username: '', api_key: '', role: 'developer' });
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRole = async (u: UserRow, role: string) => {
    try {
      await apiPut(`/api/users/${u.id}`, { role });
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRotate = async (u: UserRow) => {
    if (!window.confirm(t.users.rotateConfirm(u.username))) return;
    try {
      const res = await apiPost<{ api_key: string }>(`/api/users/${u.id}/rotate-key`);
      setRotatedKey({ username: u.username, key: res.api_key });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (u: UserRow) => {
    if (!window.confirm(t.users.deleteConfirm(u.username))) return;
    try {
      await apiDelete(`/api/users/${u.id}`);
      setRotatedKey(null);
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (isAdmin === false) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold dark:text-gray-100">{t.users.title}</h2>
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          {t.users.adminOnly}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold dark:text-gray-100">{t.users.title}</h2>
        <Button onClick={() => setShowCreate(!showCreate)} disabled={showCreate}>{t.users.create}</Button>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</p>}

      {showCreate && (
        <Card className="mb-6">
          <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-200">{t.users.createTitle}</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{t.users.username}</label>
              <Input value={createForm.username} onChange={e => setCreateForm({ ...createForm, username: e.target.value })} required placeholder="zhangsan" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{t.users.initialKey}</label>
              <Input value={createForm.api_key} onChange={e => setCreateForm({ ...createForm, api_key: e.target.value })} required placeholder="请生成一个强密钥" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{t.users.role}</label>
              <select value={createForm.role} onChange={e => setCreateForm({ ...createForm, role: e.target.value })} className={tokens.input}>
                <option value="developer">开发者</option>
                <option value="viewer">只读</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div className="col-span-3 flex gap-2">
              <Button type="submit">{t.users.createBtn}</Button>
              <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}

      {rotatedKey && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/30">
          <p className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            {t.users.newKey(rotatedKey.username)}
          </p>
          <code className="block break-all rounded bg-white px-2 py-1.5 font-mono text-xs dark:bg-gray-800">{rotatedKey.key}</code>
          <button
            onClick={() => navigator.clipboard?.writeText(rotatedKey.key).catch(() => {})}
            className="mt-2 text-xs text-amber-700 underline dark:text-amber-400"
          >
            {t.common.copy}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {users.map(u => (
          <Card key={u.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-800 dark:text-gray-100">{u.username}</span>
                <Badge color={u.role === 'admin' ? 'purple' : u.role === 'developer' ? 'green' : 'gray'}>
                  {ROLE_LABELS[u.role] || u.role}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {u.id} · {t.common.created} {new Date(u.created_at * 1000).toLocaleString()}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <select
                value={u.role}
                onChange={e => handleRole(u, e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                title={t.users.role}
              >
                <option value="developer">开发者</option>
                <option value="viewer">只读</option>
                <option value="admin">管理员</option>
              </select>
              <Button variant="ghost" onClick={() => handleRotate(u)}>{t.users.rotateKey}</Button>
              <Button variant="danger" onClick={() => handleDelete(u)}>{t.common.delete}</Button>
            </div>
          </Card>
        ))}
        {users.length === 0 && <p className="py-8 text-center text-gray-400 dark:text-gray-500">{t.users.empty}</p>}
      </div>
    </div>
  );
}
