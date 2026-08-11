'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPut } from '@/lib/api';
import { Button, Input } from '@/components/ui';

interface Safety {
  max_evolution_rounds: number;
  max_cost_per_evolution: number;
  require_human_approval: boolean;
  blocked_domains: string[];
}

const DEFAULTS: Safety = {
  max_evolution_rounds: 10,
  max_cost_per_evolution: 5.0,
  require_human_approval: true,
  blocked_domains: [],
};

export function SafetySettings() {
  const [safety, setSafety] = useState<Safety>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const fetchSafety = useCallback(async () => {
    try {
      const data = await apiGet<{ safety: Safety }>('/api/settings/safety');
      setSafety(data.safety);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { fetchSafety(); }, [fetchSafety]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await apiPut('/api/settings/safety', safety);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const label = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

  return (
    <div>
      <h2 className="text-lg font-semibold dark:text-gray-100">安全策略</h2>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">控制 Agent 自进化的边界，防止失控</p>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</p>}

      <div className="max-w-lg space-y-4">
        <div>
          <label className={label}>最大进化轮次</label>
          <Input type="number" value={safety.max_evolution_rounds} onChange={e => setSafety({ ...safety, max_evolution_rounds: +e.target.value })} />
        </div>

        <div>
          <label className={label}>单次进化最大费用（USD）</label>
          <Input type="number" step="0.1" value={safety.max_cost_per_evolution} onChange={e => setSafety({ ...safety, max_cost_per_evolution: +e.target.value })} />
        </div>

        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={safety.require_human_approval}
            onChange={e => setSafety({ ...safety, require_human_approval: e.target.checked })}
            className="h-4 w-4 accent-blue-500"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">进化结果需要人工审批后才能部署</span>
        </label>

        <div>
          <label className={label}>禁止进化的领域（逗号分隔）</label>
          <Input
            value={safety.blocked_domains.join(', ')}
            onChange={e => setSafety({ ...safety, blocked_domains: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            placeholder="例如：医疗, 法律, 金融"
          />
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : saved ? '✅ 已保存' : '保存设置'}
        </Button>
      </div>
    </div>
  );
}
