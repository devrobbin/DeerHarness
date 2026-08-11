'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, Input, Spinner, tokens } from '@/components/ui';

interface Model {
  id: string;
  name: string;
  provider: string;
  base_url?: string;
  api_key_env?: string;
  max_tokens: number;
  temperature: number;
}

type TestState = { ok?: boolean; message: string; loading?: boolean };

const EMPTY_FORM = { name: '', provider: 'deepseek', base_url: '', api_key_env: '', max_tokens: 4096, temperature: 0.7 };

const PROVIDER_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  local: '本地模型',
};

export function ModelSettings() {
  const { t } = useI18n();
  const [models, setModels] = useState<Model[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Model | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

  const fetchModels = useCallback(async () => {
    try {
      const data = await apiGet<{ models: Model[] }>('/api/settings/models');
      setModels(data.models);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  const openNew = () => {
    setForm(EMPTY_FORM);
    setEditing('new');
  };

  const openEdit = (m: Model) => {
    setForm({
      name: m.name,
      provider: m.provider,
      base_url: m.base_url ?? '',
      api_key_env: m.api_key_env ?? '',
      max_tokens: m.max_tokens,
      temperature: m.temperature,
    });
    setEditing(m);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing === 'new') {
        await apiPost('/api/settings/models', { id: `m-${Date.now()}`, ...form });
      } else if (editing) {
        await apiPut(`/api/settings/models/${editing.id}`, { id: editing.id, ...form });
      }
      setEditing(null);
      await fetchModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (m: Model) => {
    if (!window.confirm(t.models.deleteConfirm(m.name))) return;
    try {
      await apiDelete(`/api/settings/models/${m.id}`);
      await fetchModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** 连通性测试（移植 PenguinHarness models-page /models/test）：真实 HTTP 探测 + 延迟 */
  const handleTest = async (m: Model) => {
    setTestStates(prev => ({ ...prev, [m.id]: { message: '', loading: true } }));
    try {
      const res = await apiPost<{ ok: boolean; latency_ms: number | null; message: string }>('/api/settings/models/test', {
        id: m.id,
        name: m.name,
        provider: m.provider,
        base_url: m.base_url,
        api_key_env: m.api_key_env,
      });
      setTestStates(prev => ({ ...prev, [m.id]: { ok: res.ok, message: res.message } }));
    } catch (err) {
      setTestStates(prev => ({ ...prev, [m.id]: { ok: false, message: err instanceof Error ? err.message : String(err) } }));
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold dark:text-gray-100">{t.models.title}</h2>
        <Button onClick={openNew} disabled={editing !== null}>{t.models.add}</Button>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</p>}

      {editing && (
        <Card className="mb-6 space-y-3">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {editing === 'new' ? t.models.new : t.models.edit}
          </h3>
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{t.models.name}</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="deepseek-chat" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{t.models.provider}</label>
              <select
                value={form.provider}
                onChange={e => setForm({ ...form, provider: e.target.value })}
                className={tokens.input}
              >
                {Object.entries(PROVIDER_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{t.models.baseUrl}</label>
              <Input
                value={form.base_url}
                onChange={e => setForm({ ...form, base_url: e.target.value })}
                placeholder="https://api.deepseek.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{t.models.apiKeyEnv}</label>
              <Input
                value={form.api_key_env}
                onChange={e => setForm({ ...form, api_key_env: e.target.value })}
                placeholder="DEEPSEEK_API_KEY"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{t.models.maxTokens}</label>
                <Input type="number" value={form.max_tokens} onChange={e => setForm({ ...form, max_tokens: +e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{t.models.temperature}</label>
                <Input type="number" step="0.1" min="0" max="2" value={form.temperature} onChange={e => setForm({ ...form, temperature: +e.target.value })} />
              </div>
            </div>
            <div className="col-span-2 flex gap-2">
              <Button type="submit" variant="primary">{t.common.save}</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-2">
        {models.map(m => {
          const test = testStates[m.id];
          return (
            <Card key={m.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-gray-800 dark:text-gray-100">{m.name}</span>
                  <Badge color={m.provider === 'local' ? 'amber' : 'purple'}>{PROVIDER_LABELS[m.provider] || m.provider}</Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                  {m.base_url || t.models.defaultAddr} · max_tokens {m.max_tokens} · temp {m.temperature}
                  {m.api_key_env ? ` · key:${m.api_key_env}` : ''}
                </p>
                {test && (
                  <p className={`mt-1 text-xs ${test.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                    {test.loading ? <Spinner label={t.common.testing} /> : `${test.ok ? '✅' : '❌'} ${test.message}`}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="ghost" onClick={() => handleTest(m)} disabled={test?.loading}>
                  {test?.ok ? t.common.retest : t.common.test}
                </Button>
                <Button variant="ghost" onClick={() => openEdit(m)}>{t.common.edit}</Button>
                <Button variant="danger" onClick={() => handleDelete(m)}>{t.common.delete}</Button>
              </div>
            </Card>
          );
        })}
        {models.length === 0 && (
          <p className="py-8 text-center text-gray-400 dark:text-gray-500">{t.models.empty}</p>
        )}
      </div>
    </div>
  );
}
