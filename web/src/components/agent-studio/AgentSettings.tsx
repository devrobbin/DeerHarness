'use client';

import React, { useEffect, useState } from 'react';
import { apiGet, apiPut } from '@/lib/api';
import { Button, Input, Spinner, tokens } from '@/components/ui';

interface Agent {
  id?: string;
  agent_id?: string;
  agentId?: string;
  name: string;
  description?: string;
  project_id?: string;
}

interface AgentConfig {
  name: string;
  description: string;
  systemPrompt?: string;
  maxTurns?: number;
  model?: {
    maxTokens?: number;
    thinkingLevel?: string;
    timeoutMs?: number;
  };
  version?: number;
}

interface AgentSettingsProps {
  agent: Agent;
  onClose: () => void;
  onSaved?: () => void;
}

const THINKING_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh'];

/**
 * Agent 设置抽屉：移植 PenguinHarness agent-settings-page 的
 * Overview（定义）/ Prompt（人设）/ Runtime（运行参数）三块。
 * 模型 ID 为 penguin 项目级配置（会话创建时选择），此处编辑运行参数。
 */
export function AgentSettings({ agent, onClose, onSaved }: AgentSettingsProps) {
  const agentId = agent.agentId ?? agent.id ?? agent.agent_id ?? '';
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ config: AgentConfig }>(`/api/agents/${encodeURIComponent(agentId)}/config`)
      .then(d => { setConfig(d.config); setError(''); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [agentId]);

  const setField = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => {
    setConfig(prev => (prev ? { ...prev, [key]: value } : prev));
  };

  const setModelField = (key: keyof NonNullable<AgentConfig['model']>, value: number | string) => {
    setConfig(prev => (prev ? { ...prev, model: { ...(prev.model ?? {}), [key]: value } } : prev));
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError('');
    try {
      await apiPut(`/api/agents/${encodeURIComponent(agentId)}/config`, {
        name: config.name,
        description: config.description,
        system_prompt: config.systemPrompt ?? '',
        max_turns: config.maxTurns,
        model: {
          max_tokens: config.model?.maxTokens,
          thinking_level: config.model?.thinkingLevel,
          timeout_ms: config.model?.timeoutMs,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const label = 'mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400';

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className="relative z-10 flex h-full w-[30rem] max-w-[92vw] flex-col bg-white shadow-2xl dark:bg-gray-800"
        style={{ animation: 'drawer-in 0.22s ease' }}
      >
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <p className="font-semibold text-gray-800 dark:text-gray-100">⚙️ Agent 设置 · {agent.name}</p>
            <p className="font-mono text-xs text-gray-400">
              {agentId}{config?.version ? ` · v${config.version}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded px-2 py-1 text-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {loading && <Spinner label="加载配置…" />}
          {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</p>}

          {config && !loading && (
            <>
              {/* 定义（移植 PenguinHarness Overview） */}
              <section>
                <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">📋 定义</h3>
                <div className="space-y-3">
                  <div>
                    <label className={label}>名称</label>
                    <Input value={config.name} onChange={e => setField('name', e.target.value)} />
                  </div>
                  <div>
                    <label className={label}>描述</label>
                    <Input value={config.description ?? ''} onChange={e => setField('description', e.target.value)} />
                  </div>
                </div>
              </section>

              {/* 人设（移植 PenguinHarness Prompt） */}
              <section>
                <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">🧠 人设（systemPrompt）</h3>
                <textarea
                  value={config.systemPrompt ?? ''}
                  onChange={e => setField('systemPrompt', e.target.value)}
                  rows={16}
                  spellCheck={false}
                  className={`${tokens.input} font-mono text-xs leading-relaxed`}
                />
                <p className="mt-1 text-right text-[11px] text-gray-400">
                  {(config.systemPrompt ?? '').length} 字符
                </p>
              </section>

              {/* 运行参数（移植 PenguinHarness Runtime） */}
              <section>
                <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">⚙️ 运行参数</h3>
                <p className="mb-2 text-[11px] text-gray-400 dark:text-gray-500">
                  模型 ID 在 penguin 项目级配置（会话创建时选择）；此处编辑执行参数
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>最大轮次（maxTurns，-1=不限）</label>
                    <Input
                      type="number"
                      value={config.maxTurns ?? -1}
                      onChange={e => setField('maxTurns', e.target.value === '' ? -1 : +e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={label}>思考级别（thinkingLevel）</label>
                    <select
                      value={config.model?.thinkingLevel ?? 'medium'}
                      onChange={e => setModelField('thinkingLevel', e.target.value)}
                      className={tokens.input}
                    >
                      {THINKING_LEVELS.map(l => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={label}>最大输出 Tokens</label>
                    <Input
                      type="number"
                      value={config.model?.maxTokens ?? 32000}
                      onChange={e => setModelField('maxTokens', e.target.value === '' ? 0 : +e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={label}>超时（ms）</label>
                    <Input
                      type="number"
                      value={config.model?.timeoutMs ?? 120000}
                      onChange={e => setModelField('timeoutMs', e.target.value === '' ? 0 : +e.target.value)}
                    />
                  </div>
                </div>
              </section>

              <div className="flex items-center gap-2">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? '保存中…' : saved ? '✅ 已保存' : '保存修改'}
                </Button>
                <Button variant="ghost" onClick={onClose}>取消</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
