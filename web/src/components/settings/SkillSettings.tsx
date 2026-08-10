'use client';

import React, { useEffect, useState } from 'react';

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8080';

interface Skill {
  id: string;
  name: string;
  description: string;
  type: string;
}

export function SkillSettings() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', type: 'tool' });

  const fetchSkills = async () => {
    try {
      const res = await fetch(`${GATEWAY}/api/settings/skills`);
      const data = await res.json();
      setSkills(data.skills);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchSkills(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch(`${GATEWAY}/api/settings/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Date.now().toString(), ...form, config: {} }),
    });
    setShowForm(false);
    setForm({ name: '', description: '', type: 'tool' });
    fetchSkills();
  };

  const handleDelete = async (id: string) => {
    await fetch(`${GATEWAY}/api/settings/skills/${id}`, { method: 'DELETE' });
    fetchSkills();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">技能管理</h2>
        <button onClick={() => setShowForm(!showForm)} className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">
          + 添加技能
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="mb-6 p-4 bg-gray-50 rounded-lg space-y-3">
          <input placeholder="技能名称" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full p-2 border rounded text-sm" required />
          <input placeholder="描述" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full p-2 border rounded text-sm" />
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full p-2 border rounded text-sm">
            <option value="tool">工具</option>
            <option value="workflow">工作流</option>
            <option value="prompt_template">Prompt 模板</option>
          </select>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-1.5 text-sm bg-green-500 text-white rounded">保存</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-1.5 text-sm bg-gray-300 rounded">取消</button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {skills.map(s => (
          <div key={s.id} className="flex items-center justify-between p-3 bg-white border rounded-lg">
            <div>
              <span className="font-medium">{s.name}</span>
              <span className="ml-2 text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded">{s.type}</span>
              <p className="text-xs text-gray-500 mt-1">{s.description}</p>
            </div>
            <button onClick={() => handleDelete(s.id)} className="text-red-500 text-sm hover:text-red-700">删除</button>
          </div>
        ))}
        {skills.length === 0 && <p className="text-center text-gray-400 py-8">暂无技能</p>}
      </div>
    </div>
  );
}
