'use client';

import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { Badge, Button, Spinner, tokens } from '@/components/ui';

interface SkillMeta {
  name: string;
  description?: string;
  shortDescription?: string;
  version?: number;
  updated?: string;
}

interface SkillGroup {
  id: string;
  title: string;
  titleZh?: string;
  skills: SkillMeta[];
}

interface SkillsTabProps {
  agentId: string;
}

/** 🧩 技能 Tab：技能库浏览 + 安装/卸载（移植 PenguinHarness Skills tab） */
export function SkillsTab({ agentId }: SkillsTabProps) {
  const [groups, setGroups] = useState<SkillGroup[]>([]);
  const [installed, setInstalled] = useState<SkillMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [lib, ins] = await Promise.all([
        apiGet<{ groups: SkillGroup[] }>('/api/agents/skills-library'),
        apiGet<{ skills: SkillMeta[] }>(`/api/agents/${encodeURIComponent(agentId)}/skills`),
      ]);
      setGroups(lib.groups ?? []);
      setInstalled(ins.skills ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [agentId]);

  const installedNames = new Set(installed.map(s => s.name));

  const handleInstall = async (name: string) => {
    try {
      await apiPost(`/api/agents/${encodeURIComponent(agentId)}/skills`, { names: [name] });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUninstall = async (name: string) => {
    if (!window.confirm(`卸载技能「${name}」？`)) return;
    try {
      await apiDelete(`/api/agents/${encodeURIComponent(agentId)}/skills/${name}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) return <Spinner label="加载技能库…" />;

  return (
    <div className="space-y-4">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</p>}

      {/* 已安装 */}
      <div>
        <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
          📦 已安装（{installed.length}）
        </p>
        <div className="space-y-1.5">
          {installed.map(s => (
            <div key={s.name} className="flex items-center justify-between rounded border border-green-200 bg-green-50/50 px-2.5 py-1.5 dark:border-green-800 dark:bg-green-900/20">
              <div className="min-w-0">
                <span className="text-xs font-medium text-gray-800 dark:text-gray-100">{s.name}</span>
                {s.version ? <Badge color="green" >v{s.version}</Badge> : null}
                <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">{s.shortDescription || s.description}</p>
              </div>
              <button onClick={() => handleUninstall(s.name)} className="shrink-0 text-xs text-red-500 hover:text-red-700">卸载</button>
            </div>
          ))}
          {installed.length === 0 && <p className="text-xs text-gray-400">尚未安装技能</p>}
        </div>
      </div>

      {/* 技能库 */}
      <div>
        <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">📚 技能库</p>
        {groups.map(g => (
          <div key={g.id} className="mb-3">
            <p className="mb-1.5 text-[11px] font-medium text-gray-400">{g.titleZh || g.title}</p>
            <div className="space-y-1.5">
              {g.skills.map(s => {
                const isInstalled = installedNames.has(s.name);
                return (
                  <div key={s.name} className="flex items-center justify-between rounded border border-gray-200 px-2.5 py-1.5 dark:border-gray-700">
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-gray-800 dark:text-gray-100">{s.name}</span>
                      <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">{s.shortDescription || s.description}</p>
                    </div>
                    <button
                      onClick={() => (isInstalled ? handleUninstall(s.name) : handleInstall(s.name))}
                      disabled={isInstalled}
                      className={`shrink-0 rounded px-2 py-0.5 text-xs transition ${
                        isInstalled
                          ? 'bg-gray-100 text-gray-400 dark:bg-gray-700'
                          : 'bg-blue-500 text-white hover:bg-blue-600'
                      }`}
                    >
                      {isInstalled ? '已安装' : '安装'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 && <p className="text-xs text-gray-400">技能库为空</p>}
      </div>

      <Button variant="ghost" onClick={load}>刷新</Button>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        技能 = agent_state/skills/&lt;name&gt;/SKILL.md，安装即注入人设上下文（{'{SKILL_METADATA}'}）
      </p>
    </div>
  );
}
