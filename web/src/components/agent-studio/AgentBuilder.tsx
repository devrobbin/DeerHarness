'use client';

import React, { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { Button, Input, tokens } from '@/components/ui';

interface ModelItem {
  provider: string;
  model_id: string;
  display_name: string;
  is_default: boolean;
}

interface SkillMeta {
  name: string;
  shortDescription?: string;
}

interface SkillGroup {
  id: string;
  title: string;
  titleZh?: string;
  skills: SkillMeta[];
}

/** 双模式 Agent Builder：一句话快速创建 / 结构化表单（参考 agency-swarm 的 GUI 心智） */
export function AgentBuilder() {
  const [mode, setMode] = useState<'quick' | 'structured'>('quick');

  // 一句话模式
  const [quick, setQuick] = useState({ name: '', description: '', system_prompt: '', tools: '', model: '' });
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState('');

  // 结构化模式
  const [models, setModels] = useState<ModelItem[]>([]);
  const [groups, setGroups] = useState<SkillGroup[]>([]);
  const [struct, setStruct] = useState({
    agent_id: '',
    name: '',
    description: '',
    system_prompt: '',
    model: '',
    tools: [] as string[],
    skills: [] as string[],
  });

  useEffect(() => {
    apiGet<{ models: ModelItem[] }>('/api/agents/models').then(d => setModels(d.models ?? [])).catch(() => {});
    apiGet<{ groups: SkillGroup[] }>('/api/agents/skills-library')
      .then(d => setGroups(d.groups ?? []))
      .catch(() => {});
  }, []);

  const handleCreate = async (e: React.FormEvent, structured: boolean) => {
    e.preventDefault();
    setBuilding(true);
    setResult('');
    try {
      const f = structured ? struct : quick;
      const data = await apiPost<{ agent: { agentId?: string; id?: string } }>('/api/agents', {
        name: f.name,
        description: f.description,
        system_prompt: f.system_prompt || undefined,
        agent_id: structured && struct.agent_id ? struct.agent_id : undefined,
        tools: structured ? struct.tools : quick.tools.split(',').map(s => s.trim()).filter(Boolean),
        model: f.model || undefined,
      });
      const agentId = (data.agent?.agentId ?? data.agent?.id) || (structured && struct.agent_id ? struct.agent_id : undefined);
      // 结构化模式：设置模型偏好 + 安装技能
      if (structured && agentId) {
        if (struct.model) {
          const [provider, ...rest] = struct.model.split('/');
          await apiPut(`/api/agents/${encodeURIComponent(agentId)}/model-pref`, { provider, model_id: rest.join('/') });
        }
        if (struct.skills.length > 0) {
          await apiPost(`/api/agents/${encodeURIComponent(agentId)}/skills`, { names: struct.skills }).catch(() => {});
        }
      }
      setResult(`✅ 创建成功：${agentId ?? JSON.stringify(data).slice(0, 100)}${structured ? '（已应用模型偏好与技能）' : ''}`);
      if (structured) {
        setStruct({ agent_id: '', name: '', description: '', system_prompt: '', model: '', tools: [], skills: [] });
      } else {
        setQuick({ name: '', description: '', system_prompt: '', tools: '', model: '' });
      }
    } catch (err) {
      setResult(`❌ 创建失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setBuilding(false);
    }
  };

  const label = 'mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400';

  return (
    <div className="h-full rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">🛠️ Agent Builder</h2>
        <div className="flex gap-1">
          <button
            onClick={() => setMode('quick')}
            className={`rounded-full px-2.5 py-1 text-xs transition ${mode === 'quick' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}
          >
            ⚡ 一句话
          </button>
          <button
            onClick={() => setMode('structured')}
            className={`rounded-full px-2.5 py-1 text-xs transition ${mode === 'structured' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}
          >
            📝 结构化
          </button>
        </div>
      </div>

      {mode === 'quick' && (
        <form onSubmit={e => handleCreate(e, false)} className="space-y-2">
          <input
            placeholder="Agent 名称"
            value={quick.name}
            onChange={e => setQuick({ ...quick, name: e.target.value })}
            className={`${tokens.input} text-sm`}
            required
          />
          <input
            placeholder="描述"
            value={quick.description}
            onChange={e => setQuick({ ...quick, description: e.target.value })}
            className={`${tokens.input} text-sm`}
          />
          <textarea
            placeholder="System Prompt（可选，留空则由 PenguinHarness 生成）"
            value={quick.system_prompt}
            onChange={e => setQuick({ ...quick, system_prompt: e.target.value })}
            className={`${tokens.input} h-20 text-sm`}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Tools（逗号分隔）"
              value={quick.tools}
              onChange={e => setQuick({ ...quick, tools: e.target.value })}
              className={`${tokens.input} text-sm`}
            />
            <input
              placeholder="模型"
              value={quick.model}
              onChange={e => setQuick({ ...quick, model: e.target.value })}
              className={`${tokens.input} text-sm`}
            />
          </div>
          <Button type="submit" disabled={building} className="w-full">
            {building ? '构建中…' : '⚡ 生成 Agent'}
          </Button>
        </form>
      )}

      {mode === 'structured' && (
        <form onSubmit={e => handleCreate(e, true)} className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label}>Agent ID（可选，自动生成）</label>
              <input
                placeholder="amazon_analyst2"
                value={struct.agent_id}
                onChange={e => setStruct({ ...struct, agent_id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                className={`${tokens.input} font-mono text-sm`}
              />
            </div>
            <div>
              <label className={label}>名称</label>
              <input placeholder="Amazon 运营分析师 2" value={struct.name} onChange={e => setStruct({ ...struct, name: e.target.value })} className={`${tokens.input} text-sm`} required />
            </div>
          </div>
          <div>
            <label className={label}>描述</label>
            <input placeholder="一句话说明职责" value={struct.description} onChange={e => setStruct({ ...struct, description: e.target.value })} className={`${tokens.input} text-sm`} />
          </div>
          <div>
            <label className={label}>人设（System Prompt）</label>
            <textarea placeholder="# Role\n你是…" value={struct.system_prompt} onChange={e => setStruct({ ...struct, system_prompt: e.target.value })} className={`${tokens.input} h-24 font-mono text-xs`} />
          </div>
          <div>
            <label className={label}>默认模型（偏好层）</label>
            <select value={struct.model} onChange={e => setStruct({ ...struct, model: e.target.value })} className={tokens.input}>
              <option value="">🌐 项目默认</option>
              {models.map(m => (
                <option key={`${m.provider}/${m.model_id}`} value={`${m.provider}/${m.model_id}`}>
                  {m.display_name} · {m.provider}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>内置工具（默认全开）</label>
            <div className="flex flex-wrap gap-1.5">
              {['read_file', 'write_file', 'edit_file', 'list_dir', 'web_search', 'web_fetch', 'run_command', 'task', 'ask_clarification'].map(tool => (
                <button
                  key={tool}
                  type="button"
                  onClick={() => setStruct(s => ({ ...s, tools: s.tools.includes(tool) ? s.tools.filter(x => x !== tool) : [...s.tools, tool] }))}
                  className={`rounded-full px-2 py-0.5 font-mono text-[11px] transition ${
                    struct.tools.includes(tool)
                      ? 'bg-purple-100 font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                  }`}
                >
                  {struct.tools.includes(tool) ? '✓ ' : ''}{tool}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-gray-400">勾选 = 安装时启用（空 = 全部启用）</p>
          </div>
          <div>
            <label className={label}>初始技能（从技能库勾选）</label>
            <div className="max-h-28 space-y-1 overflow-y-auto">
              {groups.map(g => (
                <div key={g.id}>
                  <p className="text-[11px] text-gray-400">{g.titleZh || g.title}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {g.skills.map(s => (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => setStruct(st => ({ ...st, skills: st.skills.includes(s.name) ? st.skills.filter(x => x !== s.name) : [...st.skills, s.name] }))}
                        className={`rounded-full px-2 py-0.5 text-[11px] transition ${
                          struct.skills.includes(s.name)
                            ? 'bg-green-100 font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {struct.skills.includes(s.name) ? '✓ ' : ''}{s.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={building} className="w-full">
            {building ? '构建中…' : '📝 创建 Agent（含模型偏好与技能）'}
          </Button>
        </form>
      )}

      {result && <p className="mt-3 break-all text-xs text-gray-600 dark:text-gray-300">{result}</p>}
    </div>
  );
}
