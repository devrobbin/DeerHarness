'use client';

import React, { useEffect, useState } from 'react';

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8080';

interface Model {
  id: string;
  name: string;
  provider: string;
  base_url?: string;
  max_tokens: number;
  temperature: number;
}

export function ModelSettings() {
  const [models, setModels] = useState<Model[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    provider: 'deepseek',
    base_url: '',
    max_tokens: 4096,
    temperature: 0.7,
  });

  const fetchModels = async () => {
    try {
      const res = await fetch(`${GATEWAY}/api/settings/models`);
      const data = await res.json();
      setModels(data.models);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { fetchModels(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch(`${GATEWAY}/api/settings/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Date.now().toString(), ...form }),
    });
    setShowForm(false);
    setForm({ name: '', provider: 'deepseek', base_url: '', max_tokens: 4096, temperature: 0.7 });
    fetchModels();
  };

  const handleDelete = async (id: string) => {
    await fetch(`${GATEWAY}/api/settings/models/${id}`, { method: 'DELETE' });
    fetchModels();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">模型管理</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          + 添加模型
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="mb-6 p-4 bg-gray-50 rounded-lg space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="模型名称"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="p-2 border rounded text-sm"
              required
            />
            <select
              value={form.provider}
              onChange={e => setForm({ ...form, provider: e.target.value })}
              className="p-2 border rounded text-sm"
            >
              <option value="deepseek">DeepSeek</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="local">本地模型</option>
            </select>
            <input
              placeholder="Base URL（可选）"
              value={form.base_url}
              onChange={e => setForm({ ...form, base_url: e.target.value })}
              className="p-2 border rounded text-sm"
            />
            <input
              type="number"
              placeholder="Max Tokens"
              value={form.max_tokens}
              onChange={e => setForm({ ...form, max_tokens: +e.target.value })}
              className="p-2 border rounded text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 text-sm bg-green-500 text-white rounded">
              保存
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-1.5 text-sm bg-gray-300 rounded">
              取消
            </button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {models.map(m => (
          <div key={m.id} className="flex items-center justify-between p-3 bg-white border rounded-lg">
            <div>
              <span className="font-medium">{m.name}</span>
              <span className="ml-2 text-xs px-2 py-0.5 bg-gray-100 rounded">{m.provider}</span>
            </div>
            <button onClick={() => handleDelete(m.id)} className="text-red-500 text-sm hover:text-red-700">
              删除
            </button>
          </div>
        ))}
        {models.length === 0 && (
          <p className="text-center text-gray-400 py-8">暂无模型配置</p>
        )}
      </div>
    </div>
  );
}
