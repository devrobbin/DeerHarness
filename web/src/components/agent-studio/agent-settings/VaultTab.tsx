'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '@/lib/api';
import { Button, Input } from '@/components/ui';

interface VaultEntry {
  key: string;
  value?: string;
  valueMasked?: string;
}

interface VaultTabProps {
  agentId: string;
}

/** 🔐 Vault Tab：环境变量 key/value（值掩码显示，整表保存，移植 PenguinHarness Vault tab） */
export function VaultTab({ agentId }: VaultTabProps) {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiGet<{ entries: VaultEntry[] }>(`/api/agents/${encodeURIComponent(agentId)}/vault`);
      setEntries(d.entries ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [agentId]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // 空 value = 保留现有值（与 penguin 契约一致）；"__DELETE__" 标记删除
      await apiPut(`/api/agents/${encodeURIComponent(agentId)}/vault`, {
        entries: entries
          .filter(e => e.key.trim() && e.value !== '__DELETE__')
          .map(e => ({ key: e.key.trim(), value: e.value?.trim() || undefined })),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const update = (i: number, patch: Partial<VaultEntry>) => {
    setEntries(prev => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  };

  if (loading) return <p className="text-xs text-gray-400">加载 Vault…</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        环境变量（值仅显示掩码；留空 = 保留现有值；输入 __DELETE__ = 删除该键）
      </p>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</p>}

      <div className="space-y-2">
        {entries.map((e, i) => (
          <div key={`${e.key}-${i}`} className="flex items-center gap-2">
            <Input value={e.key} onChange={ev => update(i, { key: ev.target.value })} className="flex-1 font-mono text-xs" placeholder="KEY_NAME" />
            <Input
              type="password"
              value={e.value ?? e.valueMasked ?? ''}
              onChange={ev => update(i, { value: ev.target.value })}
              className="flex-1 font-mono text-xs"
              placeholder={e.valueMasked ? '••••（已设置）' : '值'}
            />
            <button
              onClick={() => update(i, { value: '__DELETE__' })}
              className="shrink-0 text-xs text-red-500 hover:text-red-700"
            >
              删除
            </button>
          </div>
        ))}
        {entries.length === 0 && <p className="text-xs text-gray-400">暂无环境变量</p>}
      </div>

      <div className="flex gap-2">
        <Button onClick={() => setEntries([...entries, { key: '', value: '' }])}>+ 添加变量</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : saved ? '✅ 已保存' : '保存 Vault'}
        </Button>
      </div>
    </div>
  );
}
