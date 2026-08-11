'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '@/lib/api';
import { Badge, Button, Input, tokens } from '@/components/ui';

interface McpEntry {
  name: string;
  config: Record<string, unknown>;
}

interface McpTabProps {
  agentId: string;
  servers: McpEntry[];
  onConfigChange: (servers: McpEntry[]) => void;
  onSaved: () => void;
}

/** 🔌 MCP Tab：per-agent MCP 服务器（penguin 仅存储 {name, config}，本层提供富编辑） */
export function McpTab({ agentId, servers, onConfigChange, onSaved }: McpTabProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', transport: 'stdio', command: '', args: '', url: '', env: '{}', enabled: true });

  useEffect(() => { setAdding(false); }, [agentId]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await apiPut(`/api/agents/${encodeURIComponent(agentId)}/config`, { mcp_servers: servers });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = () => {
    if (!form.name.trim()) { setError('名称必填'); return; }
    let env: Record<string, string>;
    try {
      env = JSON.parse(form.env || '{}');
    } catch {
      setError('env 不是合法 JSON');
      return;
    }
    const config: Record<string, unknown> = { transport: form.transport, enabled: form.enabled };
    if (form.transport === 'stdio') {
      config.command = form.command;
      config.args = form.args.split(/\s+/).filter(Boolean);
    } else {
      config.url = form.url;
    }
    config.env = env;
    onConfigChange([...servers, { name: form.name.trim(), config }]);
    setForm({ name: '', transport: 'stdio', command: '', args: '', url: '', env: '{}', enabled: true });
    setAdding(false);
    setError('');
  };

  const handleRemove = (i: number) => {
    if (!window.confirm(`移除 MCP 服务器「${servers[i].name}」？`)) return;
    onConfigChange(servers.filter((_, idx) => idx !== i));
  };

  const label = 'mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400';

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        per-agent MCP 服务器（stdio / SSE）。penguin 当前仅存储配置，执行由融合链路使用
      </p>

      <div className="space-y-2">
        {servers.map((s, i) => {
          const cfg = (s.config ?? {}) as Record<string, unknown>;
          return (
            <div key={s.name} className="flex items-center justify-between rounded border border-gray-200 px-2.5 py-2 dark:border-gray-700">
              <div className="min-w-0">
                <span className="text-xs font-medium text-gray-800 dark:text-gray-100">{s.name}</span>
                <Badge color={cfg.enabled === false ? 'gray' : 'green'}>
                  {cfg.enabled === false ? '禁用' : '启用'} · {cfg.transport as string}
                </Badge>
                <p className="truncate text-[11px] font-mono text-gray-500 dark:text-gray-400">
                  {cfg.transport === 'sse' ? (cfg.url as string) : `${cfg.command as string} ${((cfg.args as string[]) ?? []).join(' ')}`}
                </p>
              </div>
              <button onClick={() => handleRemove(i)} className="shrink-0 text-xs text-red-500 hover:text-red-700">移除</button>
            </div>
          );
        })}
        {servers.length === 0 && <p className="text-xs text-gray-400">未配置 MCP 服务器</p>}
      </div>

      {adding && (
        <div className="space-y-2 rounded border border-gray-200 p-3 dark:border-gray-700">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label}>名称</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="filesystem" />
            </div>
            <div>
              <label className={label}>传输方式</label>
              <select value={form.transport} onChange={e => setForm({ ...form, transport: e.target.value as 'stdio' | 'sse' })} className={tokens.input}>
                <option value="stdio">stdio</option>
                <option value="sse">SSE</option>
              </select>
            </div>
          </div>
          {form.transport === 'stdio' ? (
            <>
              <div>
                <label className={label}>命令</label>
                <Input value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} placeholder="npx -y @modelcontextprotocol/server-filesystem" />
              </div>
              <div>
                <label className={label}>参数（空格分隔）</label>
                <Input value={form.args} onChange={e => setForm({ ...form, args: e.target.value })} placeholder="/data" />
              </div>
            </>
          ) : (
            <div>
              <label className={label}>SSE URL</label>
              <Input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="http://localhost:9000/sse" />
            </div>
          )}
          <div>
            <label className={label}>env（JSON，可选）</label>
            <textarea value={form.env} onChange={e => setForm({ ...form, env: e.target.value })} rows={2} spellCheck={false} className={`${tokens.input} font-mono text-xs`} />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleAdd}>添加</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>取消</Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : saved ? '✅ 已保存' : '保存 MCP 配置'}
        </Button>
        <Button variant="ghost" onClick={() => setAdding(!adding)}>+ 添加服务器</Button>
      </div>
    </div>
  );
}
