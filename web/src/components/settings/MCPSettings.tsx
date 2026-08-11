'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { Badge, Button, Card, Input, Spinner, tokens } from '@/components/ui';

interface MCPServer {
  id: string;
  name: string;
  transport: string;
  command?: string;
  url?: string;
  env: Record<string, string>;
  enabled: boolean;
}

type TestState = { ok?: boolean; message: string; loading?: boolean };

interface FormState {
  name: string;
  transport: 'stdio' | 'sse';
  command: string;
  url: string;
  env: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = { name: '', transport: 'stdio', command: '', url: '', env: '{}', enabled: true };

/** MCP 服务器：启用开关 + 状态测试移植 DeerFlow tool-settings（Switch 行 + 状态 Badge） */
export function MCPSettings() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<MCPServer | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

  const fetchServers = useCallback(async () => {
    try {
      const data = await apiGet<{ mcp_servers: MCPServer[] }>('/api/settings/mcp');
      setServers(data.mcp_servers);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { fetchServers(); }, [fetchServers]);

  const openNew = () => { setForm(EMPTY_FORM); setEditing('new'); };

  const openEdit = (s: MCPServer) => {
    setForm({
      name: s.name,
      transport: s.transport as 'stdio' | 'sse',
      command: s.command ?? '',
      url: s.url ?? '',
      env: JSON.stringify(s.env ?? {}, null, 2),
      enabled: s.enabled,
    });
    setEditing(s);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    let env: Record<string, string>;
    try {
      env = JSON.parse(form.env || '{}');
    } catch {
      setError('env 不是合法 JSON');
      return;
    }
    try {
      const body = {
        name: form.name,
        transport: form.transport,
        command: form.transport === 'stdio' ? form.command : undefined,
        url: form.transport === 'sse' ? form.url : undefined,
        env,
        enabled: form.enabled,
      };
      if (editing === 'new') {
        await apiPost('/api/settings/mcp', { id: `mcp-${Date.now()}`, ...body });
      } else if (editing) {
        await apiPut(`/api/settings/mcp/${editing.id}`, { id: editing.id, ...body });
      }
      setEditing(null);
      await fetchServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (s: MCPServer) => {
    if (!window.confirm(`删除 MCP 服务器「${s.name}」？`)) return;
    try {
      await apiDelete(`/api/settings/mcp/${s.id}`);
      await fetchServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggle = async (s: MCPServer) => {
    try {
      await apiPut(`/api/settings/mcp/${s.id}`, { ...s, enabled: !s.enabled });
      await fetchServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTest = async (s: MCPServer) => {
    setTestStates(prev => ({ ...prev, [s.id]: { message: '', loading: true } }));
    try {
      const res = await apiPost<{ ok: boolean; message: string }>(`/api/settings/mcp/${s.id}/test`);
      setTestStates(prev => ({ ...prev, [s.id]: { ok: res.ok, message: res.message } }));
    } catch (err) {
      setTestStates(prev => ({ ...prev, [s.id]: { ok: false, message: err instanceof Error ? err.message : String(err) } }));
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold dark:text-gray-100">MCP 服务器</h2>
        <Button onClick={openNew} disabled={editing !== null}>+ 添加 MCP</Button>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">{error}</p>}

      {editing && (
        <Card className="mb-6 space-y-3">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">{editing === 'new' ? '新增 MCP 服务器' : '编辑 MCP 服务器'}</h3>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">名称</label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">传输方式</label>
                <select
                  value={form.transport}
                  onChange={e => setForm({ ...form, transport: e.target.value as 'stdio' | 'sse' })}
                  className={tokens.input}
                >
                  <option value="stdio">stdio</option>
                  <option value="sse">SSE</option>
                </select>
              </div>
            </div>
            {form.transport === 'stdio' ? (
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">启动命令</label>
                <Input
                  value={form.command}
                  onChange={e => setForm({ ...form, command: e.target.value })}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp"
                />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">SSE 端点 URL</label>
                <Input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="http://localhost:9000/sse" />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">env（JSON，可选）</label>
              <textarea
                value={form.env}
                onChange={e => setForm({ ...form, env: e.target.value })}
                rows={4}
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
        {servers.map(s => {
          const test = testStates[s.id];
          return (
            <Card key={s.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`truncate font-medium ${s.enabled ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>{s.name}</span>
                  <Badge color={s.transport === 'sse' ? 'amber' : 'green'}>{s.transport}</Badge>
                  {!s.enabled && <Badge color="gray">已禁用</Badge>}
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{s.command || s.url}</p>
                {test && (
                  <p className={`mt-1 text-xs ${test.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                    {test.loading ? <Spinner label="测试中…" /> : `${test.ok ? '✅' : '❌'} ${test.message}`}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => handleToggle(s)}
                  title={s.enabled ? '禁用' : '启用'}
                  className={`relative h-5 w-9 rounded-full transition ${s.enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${s.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
                <Button variant="ghost" onClick={() => handleTest(s)} disabled={test?.loading}>
                  {test?.ok ? '重测' : '测试'}
                </Button>
                <Button variant="ghost" onClick={() => openEdit(s)}>编辑</Button>
                <Button variant="danger" onClick={() => handleDelete(s)}>删除</Button>
              </div>
            </Card>
          );
        })}
        {servers.length === 0 && <p className="py-8 text-center text-gray-400 dark:text-gray-500">暂无 MCP 服务器</p>}
      </div>
    </div>
  );
}
