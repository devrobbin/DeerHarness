'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '@/lib/api';
import { Button, Input, tokens } from '@/components/ui';

interface ModelItem {
  provider: string;
  model_id: string;
  display_name: string;
  is_default: boolean;
}

interface ModelTabProps {
  agentId: string;
  config: {
    maxTurns?: number;
    model?: { maxTokens?: number; thinkingLevel?: string; timeoutMs?: number };
  };
  onConfigChange: (patch: Partial<{ maxTurns: number; model: Record<string, unknown> }>) => void;
  onSaved: () => void;
}

const THINKING_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh'];

/** 🎯 模型 Tab：每 Agent 默认模型（偏好层）+ 运行参数 */
export function ModelTab({ agentId, config, onConfigChange, onSaved }: ModelTabProps) {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [pref, setPref] = useState<{ provider: string; model_id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet<{ models: ModelItem[] }>('/api/agents/models')
      .then(d => setModels(d.models ?? []))
      .catch(() => {});
    apiGet<{ pref: { provider: string; model_id: string } | null }>(`/api/agents/${encodeURIComponent(agentId)}/model-pref`)
      .then(d => setPref(d.pref))
      .catch(() => {});
  }, [agentId]);

  const prefValue = pref ? `${pref.provider}/${pref.model_id}` : '';

  const handleSaveModel = async () => {
    setSaving(true);
    setError('');
    try {
      // 偏好选择值 = "" 表示清除（回落项目默认）；model_id 可能含斜杠（openrouter/...）
      const [provider, ...rest] = prefValue.split('/');
      const modelId = rest.join('/');
      await apiPut(`/api/agents/${encodeURIComponent(agentId)}/model-pref`, {
        provider: provider || undefined,
        model_id: modelId || undefined,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const label = 'mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400';

  return (
    <div className="space-y-4">
      <div>
        <label className={label}>每 Agent 默认模型（偏好层，会话创建时生效；留空 = 项目默认）</label>
        <select
          value={prefValue}
          onChange={e => {
            if (!e.target.value) { setPref(null); return; }
            const [provider, ...rest] = e.target.value.split('/');
            setPref({ provider, model_id: rest.join('/') });
          }}
          className={tokens.input}
        >
          <option value="">🌐 默认（项目级：DeepSeek V4 Flash）</option>
          {models.map(m => (
            <option key={`${m.provider}/${m.model_id}`} value={`${m.provider}/${m.model_id}`}>
              {m.display_name}{m.is_default ? '（默认）' : ''} · {m.provider}
            </option>
          ))}
        </select>
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        <Button onClick={handleSaveModel} disabled={saving} className="mt-2">
          {saving ? '保存中…' : saved ? '✅ 已保存' : '保存模型偏好'}
        </Button>
      </div>

      <div className="border-t border-gray-100 pt-4 dark:border-gray-700">
        <p className="mb-3 text-xs font-medium text-gray-500 dark:text-gray-400">⚙️ 运行参数（写入 penguin agent config）</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>最大轮次（maxTurns，-1=不限）</label>
            <Input type="number" value={config.maxTurns ?? -1} onChange={e => onConfigChange({ maxTurns: e.target.value === '' ? -1 : +e.target.value })} />
          </div>
          <div>
            <label className={label}>思考级别</label>
            <select
              value={config.model?.thinkingLevel ?? 'medium'}
              onChange={e => onConfigChange({ model: { ...(config.model ?? {}), thinkingLevel: e.target.value } })}
              className={tokens.input}
            >
              {THINKING_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>最大输出 Tokens</label>
            <Input type="number" value={config.model?.maxTokens ?? 32000} onChange={e => onConfigChange({ model: { ...(config.model ?? {}), maxTokens: e.target.value === '' ? 0 : +e.target.value } })} />
          </div>
          <div>
            <label className={label}>超时（ms）</label>
            <Input type="number" value={config.model?.timeoutMs ?? 120000} onChange={e => onConfigChange({ model: { ...(config.model ?? {}), timeoutMs: e.target.value === '' ? 0 : +e.target.value } })} />
          </div>
        </div>
      </div>
    </div>
  );
}
