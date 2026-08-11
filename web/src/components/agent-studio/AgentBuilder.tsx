'use client';

import React, { useState } from 'react';
import { apiPost } from '@/lib/api';

export function AgentBuilder() {
  const [form, setForm] = useState({
    name: '',
    description: '',
    system_prompt: '',
    tools: '',
    model: '',
  });
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<string>('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBuilding(true);
    setResult('');
    try {
      const body = {
        name: form.name,
        description: form.description,
        system_prompt: form.system_prompt || undefined,
        tools: form.tools.split(',').map(s => s.trim()).filter(Boolean),
        model: form.model || undefined,
      };
      const data = await apiPost('/api/agents', body);
      setResult(`✅ 创建成功：${JSON.stringify(data).slice(0, 120)}`);
      setForm({ name: '', description: '', system_prompt: '', tools: '', model: '' });
    } catch (err) {
      setResult(`❌ 创建失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="h-full rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 font-semibold">🛠️ Agent Builder（一句话造 Agent）</h2>
      <form onSubmit={handleCreate} className="space-y-2">
        <input
          placeholder="Agent 名称"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          className="w-full p-2 border rounded text-sm"
          required
        />
        <input
          placeholder="描述"
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
          className="w-full p-2 border rounded text-sm"
        />
        <textarea
          placeholder="System Prompt（可选，留空则由 PenguinHarness 生成）"
          value={form.system_prompt}
          onChange={e => setForm({ ...form, system_prompt: e.target.value })}
          className="w-full p-2 border rounded text-sm h-20"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            placeholder="Tools（逗号分隔）"
            value={form.tools}
            onChange={e => setForm({ ...form, tools: e.target.value })}
            className="p-2 border rounded text-sm"
          />
          <input
            placeholder="模型"
            value={form.model}
            onChange={e => setForm({ ...form, model: e.target.value })}
            className="p-2 border rounded text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={building}
          className="w-full rounded bg-blue-500 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {building ? '构建中…' : '⚡ 生成 Agent'}
        </button>
      </form>
      {result && <p className="mt-3 text-xs text-gray-600 break-all">{result}</p>}
    </div>
  );
}
