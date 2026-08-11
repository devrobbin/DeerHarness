'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { Badge, Button, Card, Input, tokens } from '@/components/ui';

interface Skill {
  id: string;
  name: string;
  description: string;
  type: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

const EMPTY_FORM = { name: '', description: '', type: 'tool', config: '{}', enabled: true };

const TYPE_LABELS: Record<string, string> = { tool: '工具', workflow: '工作流', prompt_template: 'Prompt 模板' };

/** 技能列表：启用开关移植 DeerFlow skill-settings 的 Switch 行模式 */
export function SkillSettings() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Skill | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchSkills = useCallback(async () => {
    try {
      const data = await apiGet<{ skills: Skill[] }>('/api/settings/skills');
      setSkills(data.skills);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const openNew = () => { setForm(EMPTY_FORM); setEditing('new'); };

  const openEdit = (s: Skill) => {
    setForm({
      name: s.name,
      description: s.description,
      type: s.type,
      config: JSON.stringify(s.config ?? {}, null, 2),
      enabled: s.enabled,
    });
    setEditing(s);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(form.config || '{}');
    } catch {
      setError('config 不是合法 JSON');
      return;
    }
    try {
      const body = { name: form.name, description: form.description, type: form.type, config, enabled: form.enabled };
      if (editing === 'new') {
        await apiPost('/api/settings/skills', { id: `s-${Date.now()}`, ...body });
      } else if (editing) {
        await apiPut(`/api/settings/skills/${editing.id}`, { id: editing.id, ...body });
      }
      setEditing(null);
      await fetchSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (s: Skill) => {
    if (!window.confirm(`删除技能「${s.name}」？`)) return;
    try {
      await apiDelete(`/api/settings/skills/${s.id}`);
      await fetchSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggle = async (s: Skill) => {
    try {
      await apiPut(`/api/settings/skills/${s.id}`, { ...s, enabled: !s.enabled });
      await fetchSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold dark:text-gray-100">技能管理</h2>
        <Button onClick={openNew} disabled={editing !== null}>+ 添加技能</Button>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</p>}

      {editing && (
        <Card className="mb-6 space-y-3">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">{editing === 'new' ? '新增技能' : '编辑技能'}</h3>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">名称</label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">类型</label>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className={tokens.input}>
                  {Object.entries(TYPE_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">描述</label>
              <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">config（JSON）</label>
              <textarea
                value={form.config}
                onChange={e => setForm({ ...form, config: e.target.value })}
                rows={5}
                spellCheck={false}
                className={`${tokens.input} font-mono text-xs`}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit">保存</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>取消</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-2">
        {skills.map(s => (
          <Card key={s.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`truncate font-medium ${s.enabled ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>{s.name}</span>
                <Badge color={s.type === 'workflow' ? 'amber' : 'purple'}>{TYPE_LABELS[s.type] || s.type}</Badge>
                {!s.enabled && <Badge color="gray">已禁用</Badge>}
              </div>
              <p className="mt-0.5 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">{s.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => handleToggle(s)}
                title={s.enabled ? '禁用' : '启用'}
                className={`relative h-5 w-9 rounded-full transition ${s.enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${s.enabled ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
              <Button variant="ghost" onClick={() => openEdit(s)}>编辑</Button>
              <Button variant="danger" onClick={() => handleDelete(s)}>删除</Button>
            </div>
          </Card>
        ))}
        {skills.length === 0 && <p className="py-8 text-center text-gray-400 dark:text-gray-500">暂无技能</p>}
      </div>
    </div>
  );
}
