'use client';

import { useState } from 'react';
import { apiPost, apiPut } from '@/lib/api';
import { Button, Input, tokens } from '@/components/ui';

interface ToolRow {
  name: string;
  description?: string;
  permission?: string;
  timeoutMs?: number;
  maxOutputLength?: number;
  call_description?: boolean;
}

interface ToolsTabProps {
  agentId: string;
  tools: ToolRow[];
  onConfigChange: (tools: ToolRow[]) => void;
  onSaved: () => void;
}

/** 🔧 工具 Tab：toolsBuiltin 表格（移植 PenguinHarness Tools tab，整表提交） */
export function ToolsTab({ agentId, tools, onConfigChange, onSaved }: ToolsTabProps) {
  const [saving, setSaving] = useState(false);
  // OpenAPI 工具工厂（agent 可调真实 API）
  const [oaUrl, setOaUrl] = useState('');
  const [oaSpec, setOaSpec] = useState('');
  const [oaPreview, setOaPreview] = useState<ToolRow[] | null>(null);
  const [oaApplying, setOaApplying] = useState(false);
  const [oaError, setOaError] = useState('');
  const [oaMode, setOaMode] = useState<'merge' | 'replace'>('merge');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const update = (i: number, patch: Partial<ToolRow>) => {
    onConfigChange(tools.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await apiPut(`/api/agents/${encodeURIComponent(agentId)}/config`, { tools_builtin: tools });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const cell = 'border border-gray-200 px-2 py-1 text-xs dark:border-gray-700';
  const num = (v: number | undefined) => (v === undefined || v === null ? '' : String(v));

  /** OpenAPI 预览：解析文档 → 展示将生成的工具 */
  const handlePreview = async () => {
    setOaError('');
    let spec: unknown;
    if (oaSpec.trim()) {
      try { spec = JSON.parse(oaSpec); } catch { setOaError('JSON 无效'); return; }
    }
    try {
      const d = await apiPost<{ tools: ToolRow[] }>('/api/agents/openapi/preview', {
        agent_id: agentId,
        ...(spec ? { spec } : { url: oaUrl }),
      });
      setOaPreview(d.tools ?? []);
    } catch (e) {
      setOaError(e instanceof Error ? e.message : String(e));
    }
  };

  /** OpenAPI 应用：生成工具并写入 agent（merge 合并 / replace 替换） */
  const handleApply = async () => {
    setOaApplying(true);
    setOaError('');
    let spec: unknown;
    if (oaSpec.trim()) {
      try { spec = JSON.parse(oaSpec); } catch { setOaError('JSON 无效'); return; }
    }
    try {
      await apiPost(`/api/agents/${encodeURIComponent(agentId)}/openapi/apply`, {
        agent_id: agentId,
        ...(spec ? { spec } : { url: oaUrl }),
        mode: oaMode,
      });
      setOaPreview(null);
      onSaved();
    } catch (e) {
      setOaError(e instanceof Error ? e.message : String(e));
    } finally {
      setOaApplying(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        内置工具白名单（整表保存）：permission r/rw、超时、输出上限、call_description 开关
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-gray-50 text-[11px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
              <th className={cell}>工具</th>
              <th className={cell}>权限</th>
              <th className={cell}>超时 ms</th>
              <th className={cell}>输出上限</th>
              <th className={cell}>描述参数</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t, i) => (
              <tr key={t.name} className="align-middle">
                <td className={`${cell} font-mono`}>{t.name}</td>
                <td className={cell}>
                  <select
                    value={t.permission ?? 'rw'}
                    onChange={e => update(i, { permission: e.target.value })}
                    className="rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  >
                    <option value="rw">rw</option>
                    <option value="r">r</option>
                  </select>
                </td>
                <td className={cell}>
                  <Input type="number" value={num(t.timeoutMs)} onChange={e => update(i, { timeoutMs: e.target.value === '' ? undefined : +e.target.value })} className="w-24 px-1 py-0.5 text-xs" />
                </td>
                <td className={cell}>
                  <Input type="number" value={num(t.maxOutputLength)} onChange={e => update(i, { maxOutputLength: e.target.value === '' ? undefined : +e.target.value })} className="w-24 px-1 py-0.5 text-xs" />
                </td>
                <td className={cell}>
                  <input
                    type="checkbox"
                    checked={t.call_description !== false}
                    onChange={e => update(i, { call_description: e.target.checked })}
                    className="h-3.5 w-3.5 accent-blue-500"
                  />
                </td>
              </tr>
            ))}
            {tools.length === 0 && (
              <tr><td colSpan={5} className={`${cell} text-center text-gray-400`}>该 Agent 无内置工具配置</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <Button onClick={handleSave} disabled={saving}>
        {saving ? '保存中…' : saved ? '✅ 已保存' : '保存工具配置'}
      </Button>

      {/* OpenAPI 工具工厂：把任意 HTTP API 转成 agent 工具（真实数据接入） */}
      <div className="mt-4 rounded-lg border border-purple-200 bg-purple-50/40 p-3 dark:border-purple-800 dark:bg-purple-900/10">
        <p className="mb-2 text-xs font-medium text-purple-700 dark:text-purple-300">
          🔌 OpenAPI 工具工厂（把 HTTP API 转成 agent 可调用工具，如 Amazon SP-API / TikTok Shop API）
        </p>
        <div className="space-y-2">
          <Input
            value={oaUrl}
            onChange={e => setOaUrl(e.target.value)}
            placeholder="OpenAPI 文档 URL（如 https://.../swagger.json）"
            className="font-mono text-xs"
          />
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="h-px flex-1 bg-purple-200 dark:bg-purple-800" /> 或直接粘贴 <span className="h-px flex-1 bg-purple-200 dark:bg-purple-800" />
          </div>
          <textarea
            value={oaSpec}
            onChange={e => setOaSpec(e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder='粘贴 OpenAPI JSON（可选，与 URL 二选一）'
            className={`${tokens.input} font-mono text-xs`}
          />
          <div className="flex items-center gap-2">
            <select value={oaMode} onChange={e => setOaMode(e.target.value as 'merge' | 'replace')} className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100">
              <option value="merge">合并（保留现有工具）</option>
              <option value="replace">替换（仅生成的工具）</option>
            </select>
            <Button variant="ghost" onClick={handlePreview} className="text-purple-600">预览生成</Button>
            <Button onClick={handleApply} disabled={oaApplying || (!oaUrl.trim() && !oaSpec.trim())}>
              {oaApplying ? '应用中…' : '生成并应用到 Agent'}
            </Button>
          </div>
          {oaPreview && (
            <div className="rounded bg-white p-2 dark:bg-gray-800">
              <p className="mb-1 text-xs text-purple-600 dark:text-purple-300">
                将生成 {oaPreview.length} 个工具
              </p>
              <div className="flex flex-wrap gap-1.5">
                {oaPreview.map(t => (
                  <span key={t.name} className="rounded-full bg-purple-100 px-2 py-0.5 font-mono text-[11px] text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {oaError && <p className="text-xs text-red-500">{oaError}</p>}
        </div>
      </div>
    </div>
  );
}
