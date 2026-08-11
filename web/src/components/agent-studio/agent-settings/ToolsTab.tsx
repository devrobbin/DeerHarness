'use client';

import { useState } from 'react';
import { apiPut } from '@/lib/api';
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
    </div>
  );
}
