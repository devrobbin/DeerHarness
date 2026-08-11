'use client';

import React, { useEffect, useRef, useState } from 'react';
import { apiGet, apiPut } from '@/lib/api';
import { Button, Input, Spinner, tokens } from '@/components/ui';
import { ModelTab } from '@/components/agent-studio/agent-settings/ModelTab';
import { ToolsTab } from '@/components/agent-studio/agent-settings/ToolsTab';
import { McpTab } from '@/components/agent-studio/agent-settings/McpTab';
import { SkillsTab } from '@/components/agent-studio/agent-settings/SkillsTab';
import { VaultTab } from '@/components/agent-studio/agent-settings/VaultTab';

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
  model?: { maxTokens?: number; thinkingLevel?: string; timeoutMs?: number };
  toolsBuiltin?: Record<string, unknown>[];
  mcpServers?: { name: string; config: Record<string, unknown> }[];
  version?: number;
}

interface AgentSettingsProps {
  agent: Agent;
  onClose: () => void;
  onSaved?: () => void;
}

const TABS = [
  { id: 'define', label: '📋 定义' },
  { id: 'prompt', label: '🧠 人设' },
  { id: 'model', label: '🎯 模型' },
  { id: 'tools', label: '🔧 工具' },
  { id: 'mcp', label: '🔌 MCP' },
  { id: 'skills', label: '🧩 技能' },
  { id: 'vault', label: '🔐 Vault' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Agent 设置抽屉（7 Tab，移植 PenguinHarness agent-settings-page） */
export function AgentSettings({ agent, onClose, onSaved }: AgentSettingsProps) {
  const agentId = agent.agentId ?? agent.id ?? agent.agent_id ?? '';
  const [tab, setTab] = useState<TabId>('define');
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    apiGet<{ config: AgentConfig }>(`/api/agents/${encodeURIComponent(agentId)}/config`)
      .then(d => { setConfig(d.config); setError(''); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [agentId]);

  const setField = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => {
    setConfig(prev => (prev ? { ...prev, [key]: value } : prev));
  };

  /** 保存定义/人设/运行参数（整表单提交，部分更新语义） */
  const handleSaveBasic = async () => {
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

  /** 占位符 chips：在光标处插入人设模板变量（移植 PenguinHarness Prompt tab） */
  const insertPlaceholder = (ph: string) => {
    const ta = promptRef.current;
    if (!ta || !config) return;
    const start = ta.selectionStart ?? config.systemPrompt?.length ?? 0;
    const end = ta.selectionEnd ?? start;
    const next = (config.systemPrompt ?? '').slice(0, start) + ph + (config.systemPrompt ?? '').slice(end);
    setField('systemPrompt', next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + ph.length, start + ph.length);
    });
  };

  const PLACEHOLDERS = ['{{AGENTS_MD}}', '{{VAULT_KEYS}}', '{{SKILL_METADATA}}', '{{PROVIDER}}', '{{MODEL_ID}}', '{{TOOLS}}'];

  const label = 'mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400';

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className="relative z-10 flex h-full w-[34rem] max-w-[94vw] flex-col bg-white shadow-2xl dark:bg-gray-800"
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

        {/* Tab 导航 */}
        <div className="flex flex-wrap gap-1 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-2.5 py-1 text-xs transition ${
                tab === t.id
                  ? 'bg-blue-500 font-medium text-white'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {loading && <Spinner label="加载配置…" />}
          {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</p>}

          {config && !loading && (
            <>
              {tab === 'define' && (
                <div className="space-y-3">
                  <div>
                    <label className={label}>名称</label>
                    <Input value={config.name} onChange={e => setField('name', e.target.value)} />
                  </div>
                  <div>
                    <label className={label}>描述</label>
                    <Input value={config.description ?? ''} onChange={e => setField('description', e.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleSaveBasic} disabled={saving}>
                      {saving ? '保存中…' : saved ? '✅ 已保存' : '保存'}
                    </Button>
                    <Button variant="ghost" onClick={onClose}>取消</Button>
                  </div>
                </div>
              )}

              {tab === 'prompt' && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {PLACEHOLDERS.map(ph => (
                      <button
                        key={ph}
                        onClick={() => insertPlaceholder(ph)}
                        className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[11px] text-gray-500 hover:bg-blue-50 hover:text-blue-600 dark:bg-gray-700 dark:text-gray-400"
                        title="点击在光标处插入"
                      >
                        {ph}
                      </button>
                    ))}
                  </div>
                  <textarea
                    ref={promptRef}
                    value={config.systemPrompt ?? ''}
                    onChange={e => setField('systemPrompt', e.target.value)}
                    rows={22}
                    spellCheck={false}
                    className={`${tokens.input} font-mono text-xs leading-relaxed`}
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-gray-400">{(config.systemPrompt ?? '').length} 字符</p>
                    <div className="flex gap-2">
                      <Button onClick={handleSaveBasic} disabled={saving}>
                        {saving ? '保存中…' : saved ? '✅ 已保存' : '保存人设'}
                      </Button>
                      <Button variant="ghost" onClick={() => setField('systemPrompt', '')}>清空</Button>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'model' && (
                <ModelTab
                  agentId={agentId}
                  config={config}
                  onConfigChange={patch => setConfig(prev => (prev ? { ...prev, ...patch } : prev))}
                  onSaved={() => onSaved?.()}
                />
              )}

              {tab === 'tools' && (
                <ToolsTab
                  agentId={agentId}
                  tools={(config.toolsBuiltin ?? []) as { name: string; permission?: string; timeoutMs?: number; maxOutputLength?: number; call_description?: boolean }[]}
                  onConfigChange={tools => setField('toolsBuiltin', tools as unknown as Record<string, unknown>[])}
                  onSaved={() => onSaved?.()}
                />
              )}

              {tab === 'mcp' && (
                <McpTab
                  agentId={agentId}
                  servers={config.mcpServers ?? []}
                  onConfigChange={servers => setField('mcpServers', servers)}
                  onSaved={() => onSaved?.()}
                />
              )}

              {tab === 'skills' && <SkillsTab agentId={agentId} />}

              {tab === 'vault' && <VaultTab agentId={agentId} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
