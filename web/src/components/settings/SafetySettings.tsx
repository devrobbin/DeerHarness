'use client';

import { useEffect, useState } from 'react';

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8080';

interface Safety {
  max_evolution_rounds: number;
  max_cost_per_evolution: number;
  require_human_approval: boolean;
  blocked_domains: string[];
}

export function SafetySettings() {
  const [safety, setSafety] = useState<Safety>({
    max_evolution_rounds: 10,
    max_cost_per_evolution: 5.0,
    require_human_approval: true,
    blocked_domains: [],
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${GATEWAY}/api/settings/safety`)
      .then(r => r.json())
      .then(data => setSafety(data.safety))
      .catch(console.error);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${GATEWAY}/api/settings/safety`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(safety),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">安全策略</h2>
      <p className="text-sm text-gray-500 mb-6">
        控制 Agent 自进化的边界，防止失控
      </p>

      <div className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium mb-1">最大进化轮次</label>
          <input
            type="number"
            value={safety.max_evolution_rounds}
            onChange={e => setSafety({ ...safety, max_evolution_rounds: +e.target.value })}
            className="w-full p-2 border rounded text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">单次进化最大费用（USD）</label>
          <input
            type="number"
            step="0.1"
            value={safety.max_cost_per_evolution}
            onChange={e => setSafety({ ...safety, max_cost_per_evolution: +e.target.value })}
            className="w-full p-2 border rounded text-sm"
          />
        </div>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={safety.require_human_approval}
            onChange={e => setSafety({ ...safety, require_human_approval: e.target.checked })}
            className="w-4 h-4"
          />
          <label className="text-sm">进化结果需要人工审批后才能部署</label>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">禁止进化的领域（逗号分隔）</label>
          <input
            value={safety.blocked_domains.join(', ')}
            onChange={e => setSafety({ ...safety, blocked_domains: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            placeholder="例如：医疗, 法律, 金融"
            className="w-full p-2 border rounded text-sm"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {saving ? '保存中...' : saved ? '✅ 已保存' : '保存设置'}
        </button>
      </div>
    </div>
  );
}
